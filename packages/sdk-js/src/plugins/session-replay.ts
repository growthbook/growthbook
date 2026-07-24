import { record } from "rrweb";
import type { eventWithTime } from "@rrweb/types";
import { GrowthBook } from "../GrowthBook";
import {
  SessionReplayPrivacyConfig,
  buildRrwebPrivacyOptions,
} from "./session-replay-privacy";
import { scrubEventUrls } from "./session-replay-url-scrub";
import {
  createRetry,
  RetryExhaustedError,
  RetryCancelledError,
} from "./retry-manager";
import { getOrCreateSessionReplayId } from "./session-replay-id";

export type {
  SessionReplayPrivacyConfig,
  MaskableInputType,
  SessionReplayUrlScrubberConfig,
} from "./session-replay-privacy";

type PluginOptions = {
  trackingHost?: string;
  autoRecord?: boolean;
  /**
   * Per-app kill switch. When false, the plugin loads but never starts
   * recording.
   * Default: true.
   */
  enabled?: boolean;
  /**
   * Privacy controls for what rrweb captures.
   * This option only covers input masking strategy and custom
   * transform hooks. Defaults to deny-by-default (every input masked).
   */
  privacy?: SessionReplayPrivacyConfig;
};

/**
 * Returns true when the user's browser has signaled they don't want to
 * be tracked, via either DNT (legacy) or Global Privacy Control
 * (CCPA-binding in California). When either is set we bail before
 * rrweb starts capturing — no events generated, no payloads sent.
 *
 * GPC reference: https://globalprivacycontrol.org/
 * DNT reference: https://www.w3.org/TR/tracking-dnt/ (W3C Note, 2019;
 * never made it to a Recommendation but still set by some browsers /
 * privacy extensions, so we honor it as a courtesy).
 */
function userOptedOutOfTracking(): boolean {
  if (typeof navigator === "undefined") return false;

  // navigator.doNotTrack is a string: "1" = opt out, "0" = opt in, null = no preference
  if (navigator.doNotTrack === "1") return true;

  // GPC isn't yet in standard navigator typings, hence the cast
  const gpc = (navigator as { globalPrivacyControl?: boolean })
    .globalPrivacyControl;
  if (gpc === true) return true;

  return false;
}

type PersistedReplayState = {
  sessionReplayId: string;
  sessionStartedAt: number;
  lastChunkIndex: number;
  lastChunkAt: number;
};

const REPLAY_STORAGE_KEY = "gb_session_replay";

/**
 * Maximum idle gap between successful chunk sends before a resume across a
 * page reload is rejected and a fresh session starts. Must match the
 * session replay ID manager's idle timeout (30 min): if this were shorter,
 * a reload in the gap would reuse the same session_replay_id but reset
 * chunkIndex to 0, creating a chunk-0 collision in the ingestor.
 */
const RESUME_STALENESS_MS = 30 * 60 * 1000;

function readPersistedReplayState(): PersistedReplayState | null {
  try {
    const raw = sessionStorage.getItem(REPLAY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedReplayState;
    const legacyParsed = parsed as unknown as { sessionId?: unknown };
    const sessionReplayId =
      typeof parsed?.sessionReplayId === "string"
        ? parsed.sessionReplayId
        : typeof legacyParsed.sessionId === "string"
          ? legacyParsed.sessionId
          : "";
    if (
      !sessionReplayId ||
      typeof parsed.sessionStartedAt !== "number" ||
      typeof parsed.lastChunkIndex !== "number" ||
      typeof parsed.lastChunkAt !== "number"
    ) {
      return null;
    }
    return {
      sessionReplayId,
      sessionStartedAt: parsed.sessionStartedAt,
      lastChunkIndex: parsed.lastChunkIndex,
      lastChunkAt: parsed.lastChunkAt,
    };
  } catch {
    return null;
  }
}

function writePersistedReplayState(state: PersistedReplayState): void {
  try {
    sessionStorage.setItem(REPLAY_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // sessionStorage disabled — resume-across-reloads won't work but
    // within-page recording is unaffected.
  }
}

/**
 * Circuit breaker for auth failures. When the ingest endpoint returns
 * 401 (bad clientKey) or 403 (org/key forbidden), retrying produces the
 * Exponential back-off for retriable failures (5xx / 429 / network).
 */
const RETRY_BASE_DELAY_MS = 1_000;
const RETRY_MAX_DELAY_MS = 30_000;
const RETRY_MAX_ATTEMPTS = 5;
const RETRY_JITTER_MS = 500;

/**
 *
 * IDLE_TIMEOUT_MS — how long the user can be idle (no mouse, keyboard,
 * scroll, or touch) before the current session is finalized and a new
 * one starts on the next interaction.
 *
 * MAX_DURATION_MS — hard cap on a single session's wall-clock length.
 * When exceeded the session is finalized and a new one begins
 * automatically, even if the user is still active.
 *
 * FLUSH_INTERVAL_MS — periodic flush cadence. A flush also fires before
 * any event that would push the buffer past FLUSH_BYTE_SIZE, so this is
 * the upper bound on how stale buffered events can be before being
 * shipped.
 *
 * FLUSH_BYTE_SIZE — flush before any event whose addition would push the
 * approximate serialized buffer size past this. Computed as the running
 * sum of JSON.stringify(event).length since the last flush — not exact
 * (JS strings are UTF-16) but a close-enough upper bound. Sized to keep the
 * gzipped chunk under fetch keepalive's 64KB body limit (~8-15x ratio for
 * rrweb data), so the pagehide/unload flush still uses keepalive and
 * delivers. 256KB uncompressed → typically ~17-32KB on the wire, comfortably
 * under the keepalive ceiling (see sendChunk's useKeepalive fallback).
 * (Temporarily reverted from a 512KB experiment pending a platform-team
 * discussion on larger chunks / the ingest 10MB decompressed limit.)
 *
 * MAX_BUFFERED_EVENTS — hard cap on the in-memory event buffer (scaled with
 * FLUSH_BYTE_SIZE to keep ~512 bytes/event headroom). New events are dropped
 * once the cap is hit so the buffer can't grow without bound if every flush
 * is failing (e.g. user offline).
 *
 * COMPRESS_REQUESTS — gzip the request body via the browser's native
 * CompressionStream before POSTing. T
 */
const IDLE_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_DURATION_MS = 30 * 60 * 1000;
const FLUSH_INTERVAL_MS = 60_000;
const FLUSH_BYTE_SIZE = 256 * 1024;
const MAX_BUFFERED_EVENTS = 500;
const COMPRESS_REQUESTS = true;

export function sessionReplayPlugin({
  trackingHost = "",
  autoRecord = true,
  enabled = true,
  privacy,
}: PluginOptions = {}) {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("sessionReplayPlugin only works in the browser");
  }

  let gbRef: GrowthBook | null = null;
  let host = "";
  let clientKey = "";

  let stopFn: (() => void) | undefined;
  let isRecording = false;
  let sessionReplayId = "";
  let chunkIndex = 0;
  let hasUserInteraction = false;
  let sessionStartedAt = 0;
  let viewportWidth = 0;
  let viewportHeight = 0;
  let lastInteractionAt = 0;
  // Re-entrancy guard for flushBuffer. The timer, size trigger, stopRecording,
  // pagehide, and visibilitychange handlers can all fire while a previous
  // flush is awaiting its network response — without this, a concurrent flush
  // would race the buffer-snapshot/clear and double-send the same events.
  let flushInFlight = false;
  let flushInterval: ReturnType<typeof setInterval> | null = null;
  let idleCheckInterval: ReturnType<typeof setInterval> | null = null;
  // Running estimate of the buffer's serialized size in bytes, used by the
  // size-based flush trigger. Reset whenever the buffer is cleared. This is
  // an upper-bound approximation
  let bufferedBytes = 0;
  // Event buffer kept in closure scope — not on window — so third-party
  // scripts cannot read, mutate, or clear it.
  let replayEvents: eventWithTime[] = [];

  const featureEvals: Array<{
    featureKey: string;
    timestamp: number;
    result: { value: unknown | null; experimentKey?: string };
  }> = [];
  const experimentEvals: Array<{
    key: string;
    timestamp: number;
    name?: string;
    result: {
      value: any; // eslint-disable-line @typescript-eslint/no-explicit-any
      variationId: number;
      featureId: string | null;
    };
  }> = [];
  const sessionEvents: Array<{
    eventName: string;
    timestamp: number;
    properties?: Record<string, unknown>;
  }> = [];

  /**
   * Gzip a string body via the browser's native CompressionStream API and
   * return the compressed blob, or null if compression isn't available or
   * fails. Caller is responsible for falling back to the raw payload and
   * setting `Content-Encoding: gzip` only when this returns non-null.
   */
  const gzipString = async (body: string): Promise<Blob | null> => {
    if (typeof CompressionStream === "undefined") return null;
    try {
      const inputStream = new Response(body).body;
      if (!inputStream) return null;
      const compressed = inputStream.pipeThrough(new CompressionStream("gzip"));
      return await new Response(compressed).blob();
    } catch {
      return null;
    }
  };

  /**
   * Upload one already-serialized chunk. Resolves on a 2xx response; throws
   * on a network failure or a non-2xx status so the caller (flushBuffer) can
   * detect the failure and revert the chunk so it gets retried on the next
   * flush. The previous fire-and-forget pattern silently lost chunks whenever
   * the ingestor was momentarily unavailable (dev hot reload, deploy bounce,
   * brief 5xx) — catastrophic for chunk 0 because losing the FullSnapshot
   * leaves a session unplayable.
   *
   * Uses `keepalive: true` so a pagehide-triggered flush is still delivered
   * after the page tears down. Falls back to a non-keepalive request when
   * the body exceeds fetch keepalive's 64KB body limit — happens only when
   * gzip compression was unavailable or refused; with our 256KB
   * uncompressed buffer cap and rrweb's typical 8-15x compression ratio,
   * compressed bodies usually land around 17-32KB.
   */
  const sendChunk = async (payload: string): Promise<void> => {
    let body: BodyInit = payload;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (COMPRESS_REQUESTS) {
      const gz = await gzipString(payload);
      if (gz) {
        body = gz;
        headers["Content-Encoding"] = "gzip";
      }
    }
    const bodySize = body instanceof Blob ? body.size : new Blob([body]).size;
    const useKeepalive = bodySize < 64 * 1024;
    const response = await fetch(`${host}/ingest/session-replay`, {
      method: "POST",
      headers,
      body,
      keepalive: useKeepalive,
    });
    if (!response.ok) {
      const err = new Error(
        `session-replay ingest returned ${response.status} ${response.statusText}`,
      ) as Error & { status?: number };
      err.status = response.status;
      throw err;
    }
  };

  // Wraps sendChunk with exponential back-off for retriable failures (5xx / 429 / network).
  // Permanent 4xx errors (except 429) are not retried — the payload or credentials
  // are wrong and retrying would produce the same result.
  const sendWithRetry = createRetry(
    {
      baseDelayMs: RETRY_BASE_DELAY_MS,
      maxDelayMs: RETRY_MAX_DELAY_MS,
      maxAttempts: RETRY_MAX_ATTEMPTS,
      jitterMs: RETRY_JITTER_MS,
      isRetriable: (e) => {
        const status = (e as { status?: number })?.status;
        const is4xx =
          typeof status === "number" &&
          status >= 400 &&
          status < 500 &&
          status !== 429;
        return !is4xx;
      },
    },
    sendChunk,
  );

  const flushBuffer = async (): Promise<void> => {
    // Re-entrancy guard — a flush awaiting its response should not be raced
    // by a second concurrent flush triggered by the timer / size cap /
    // pagehide / visibilitychange. The in-flight flush will continue, and
    // events accumulated while it was awaiting will be picked up by the
    // next trigger.
    if (flushInFlight) return;

    if (!gbRef || !replayEvents?.length) return;
    // First chunk must contain a full snapshot so the player can initialize
    if (chunkIndex === 0 && !replayEvents.some((e) => e.type === 2)) return;
    // Don't flush sessions with no real user interaction (filters out hot-reload noise)
    if (!hasUserInteraction) return;

    flushInFlight = true;

    const sessionReplayIdBeingSent = sessionReplayId;
    const eventsBeingSent = [...replayEvents];
    const bufferedBytesBeingSent = bufferedBytes;
    const chunkIndexBeingSent = chunkIndex;
    const featureEvalsBeingSent = featureEvals.splice(0);
    const experimentEvalsBeingSent = experimentEvals.splice(0);
    const sessionEventsBeingSent = sessionEvents.splice(0);

    try {
      const attrs = gbRef.getAttributes();
      const userIdAttr = attrs.user_id;
      const deviceIdAttr = attrs.device_id || attrs.anonymous_id || attrs.id;
      const context = {
        attributes: JSON.stringify(attrs),
        ...(typeof userIdAttr === "string" && { user_id: userIdAttr }),
        ...(typeof deviceIdAttr === "string" && { device_id: deviceIdAttr }),
      };

      // Synthesize rrweb custom events (type 5) from the typed eval buffers
      // so the replay player can show feature/experiment panels at the exact
      // timestamp they occurred.
      const customEvents: eventWithTime[] = [];
      featureEvalsBeingSent.forEach((fe) => {
        customEvents.push({
          type: 5,
          timestamp: fe.timestamp,
          data: {
            tag: "feature-flag",
            payload: { id: fe.featureKey, value: fe.result.value },
          },
        });
      });
      experimentEvalsBeingSent.forEach((ee) => {
        customEvents.push({
          type: 5,
          timestamp: ee.timestamp,
          data: {
            tag: "experiment",
            payload: { id: ee.key, variation: ee.result.variationId },
          },
        });
      });

      const events = [...eventsBeingSent, ...customEvents].sort(
        (a, b) => a.timestamp - b.timestamp,
      );

      // PII protection comes entirely from rrweb-native privacy controls
      // exposed via SessionReplayPrivacyConfig / buildRrwebPrivacyOptions:
      //   - maskAllInputs (default true)
      //   - blockClass / blockSelector / .gb-block / [data-gb-block]
      //   - maskTextClass / maskTextSelector / .gb-mask / [data-gb-mask]
      //   - ignoreClass / ignoreSelector / .gb-ignore / [data-gb-ignore]
      //   - data-gb-allow opt-back-in
      //   - maskInputFn / maskTextFn customer hooks
      //
      // The pre-transmission regex scrubber was removed pending diagnosis of
      // the replay-side leak it was meant to catch — buffer inspection
      // showed it wasn't dispatching against the surface that was actually
      // leaking. When that diagnosis lands we'll reintroduce a corrected
      // scrubber rather than restoring the previous one.

      const payload = JSON.stringify({
        clientKey,
        session_replay_id: sessionReplayId,
        chunkIndex: chunkIndexBeingSent,
        sessionStartedAt,
        viewport: { width: viewportWidth, height: viewportHeight },
        events,
        context,
        featureEvals: { items: featureEvalsBeingSent },
        experimentEvals: { items: experimentEvalsBeingSent },
        sessionEvents: { items: sessionEventsBeingSent },
      });

      // Clear the live buffer SYNCHRONOUSLY before awaiting so emits arriving
      // mid-flight land in a fresh buffer instead of being lost to a
      // "clear-after-await" race. chunkIndex is NOT advanced yet — we only
      // commit the advance once the send is acknowledged below.
      replayEvents.length = 0;
      bufferedBytes = 0;

      try {
        await sendWithRetry(payload);
        // Success — commit the chunk index advance, but only if the session
        // is still the one we sent for. If it rotated mid-flight, the new
        // session has its own chunkIndex counter starting at 0.
        if (sessionReplayId === sessionReplayIdBeingSent) {
          chunkIndex = chunkIndexBeingSent + 1;
          writePersistedReplayState({
            sessionReplayId,
            sessionStartedAt,
            lastChunkIndex: chunkIndexBeingSent,
            lastChunkAt: Date.now(),
          });
        }
      } catch (e) {
        if (e instanceof RetryCancelledError) {
          // stopRecording cancelled a pending retry. Restore the snapshotted
          // events so the final keepalive flush from stopRecording can send them.
          replayEvents.unshift(...eventsBeingSent);
          bufferedBytes += bufferedBytesBeingSent;
          featureEvals.unshift(...featureEvalsBeingSent);
          experimentEvals.unshift(...experimentEvalsBeingSent);
          sessionEvents.unshift(...sessionEventsBeingSent);
          return;
        }

        if (sessionReplayId !== sessionReplayIdBeingSent) {
          // Session rotated mid-flight — chunk is lost regardless of error class.
          console.warn(
            `session-replay: chunk ${chunkIndexBeingSent} lost during session rotation`,
            e,
          );
          return;
        }

        if (e instanceof RetryExhaustedError) {
          // All retries exhausted — treat the chunk as permanently lost so
          // recording continues rather than stalling indefinitely.
          chunkIndex = chunkIndexBeingSent + 1;
          writePersistedReplayState({
            sessionReplayId,
            sessionStartedAt,
            lastChunkIndex: chunkIndexBeingSent,
            lastChunkAt: Date.now(),
          });
          console.error(
            `session-replay: chunk ${chunkIndexBeingSent} failed after ` +
              `${RETRY_MAX_ATTEMPTS} retries; skipping`,
            e.cause,
          );
          return;
        }

        // Permanent 4XX failure (not retriable per isRetriable) — the payload
        // or credentials are unrecoverable.
        const status = (e as { status?: number })?.status;
        if (status === 401 || status === 403) {
          // Auth failure: stop recording immediately. A bad clientKey won't fix
          // itself within the page load, and pagehide would otherwise fire one
          // last keepalive POST against the same bad key.
          console.error(
            `session-replay: stopping recorder after HTTP ${status}. ` +
              "Verify your GrowthBook clientKey and that the org has " +
              "session replay enabled on the ingestor.",
            e,
          );
          replayEvents.length = 0;
          bufferedBytes = 0;
          stopRecording();
          return;
        }
        // Other 4XX (400, 413, 422, 404, …): payload is unrecoverable,
        // advance chunkIndex and continue recording.
        chunkIndex = chunkIndexBeingSent + 1;
        writePersistedReplayState({
          sessionReplayId,
          sessionStartedAt,
          lastChunkIndex: chunkIndexBeingSent,
          lastChunkAt: Date.now(),
        });
        console.error(
          `session-replay: chunk ${chunkIndexBeingSent} permanently rejected ` +
            `(HTTP ${status}); skipping`,
          e,
        );
      }
    } finally {
      flushInFlight = false;
      // If stopRecording cancelled an in-flight retry, its void flushBuffer()
      // call was a no-op (flushInFlight was still true at the time). Now that
      // the guard is clear and events have been restored by the
      // RetryCancelledError handler, fire the final keepalive flush ourselves.
      if (!isRecording && replayEvents?.length) {
        void flushBuffer();
      }
    }
  };

  // forceNew skips the persisted-state resume check. Used by checkAndRotate
  // so in-page session rotations (MAX_DURATION / idle) always start with a
  // fresh sessionStartedAt — without this, canResume restores the old
  // sessionStartedAt and tooLong stays true on the next interval, looping forever.
  const startRecording = (forceNew = false) => {
    if (isRecording) return;

    // Customer-side kill switch — set enabled: false on the plugin to
    // suppress capture for this user/app instance.
    if (!enabled) return;

    // Honor browser-level Do Not Track / Global Privacy Control signals.
    // GPC is binding under California's CCPA/CPRA; DNT is courtesy. We
    // bail BEFORE rrweb starts so no events are even generated.
    if (userOptedOutOfTracking()) return;

    const persisted = readPersistedReplayState();
    const now = Date.now();
    const nextSessionReplayId = getOrCreateSessionReplayId(forceNew);
    if (!nextSessionReplayId) return;
    void gbRef?.updateAttributes({ session_replay_id: nextSessionReplayId });

    // Resume when the persisted session_replay_id matches the internal current
    // one (same logical replay session, no forced rotation) and the last
    // successful chunk was recent enough to count as continuous activity.
    // forceNew bypasses this so in-page rotations always start fresh.
    const canResume =
      !forceNew &&
      persisted !== null &&
      persisted.sessionReplayId === nextSessionReplayId &&
      now - persisted.lastChunkAt < RESUME_STALENESS_MS;

    if (canResume) {
      sessionReplayId = nextSessionReplayId;
      sessionStartedAt = persisted.sessionStartedAt;
      chunkIndex = persisted.lastChunkIndex + 1;
    } else {
      sessionReplayId = nextSessionReplayId;
      chunkIndex = 0;
      sessionStartedAt = now;
      writePersistedReplayState({
        sessionReplayId: nextSessionReplayId,
        sessionStartedAt: now,
        lastChunkIndex: -1,
        lastChunkAt: now,
      });
    }

    // Snapshot viewport at start. window.innerWidth/Height excludes browser
    // chrome (toolbar, devtools) — matches what rrweb uses as the recording
    // canvas dimension. Re-reading every chunk would risk inconsistency if
    // the user resizes mid-session and chunks land out of order.
    viewportWidth = typeof window !== "undefined" ? window.innerWidth || 0 : 0;
    viewportHeight =
      typeof window !== "undefined" ? window.innerHeight || 0 : 0;

    hasUserInteraction = false;
    lastInteractionAt = Date.now();
    replayEvents = [];
    bufferedBytes = 0;

    const rrwebStop = record({
      emit(event: eventWithTime) {
        // Scrub URL fields BEFORE the event lands in the buffer so any
        // downstream observer (the buffer itself, the flush payload, an
        // attacker who somehow reads replayEvents) only ever
        // sees a sanitized version. Meta events are the only URL-bearing
        // events rrweb emits today; see scrubEventUrls for the contract.
        const scrubbedEvent = scrubEventUrls(event, privacy?.url);

        // Only deliberate user actions count as interaction. Anything else
        // — DOM mutations, mouse drift, scroll, viewport resize from Chrome
        // collapsing its address bar — leaves us with sessions that look
        // empty in the replay because nothing visible changed. We restrict
        // to rrweb IncrementalSource values that represent real input:
        //   2  = MouseInteraction (click, dblclick, contextmenu, focus, blur)
        //   5  = Input (form input value changes)
        //   6  = TouchMove (touch input)
        //   12 = Drag
        // See rrweb-snapshot's IncrementalSource enum for the full list.
        //
        // Check this BEFORE the cap-and-push step so an interaction that
        // arrives while we're at the hard buffer cap (e.g. all flushes are
        // failing) still flips hasUserInteraction. Otherwise a dropped
        // interaction event could leave the session stuck in pre-interaction
        // limbo and never flush.
        if (event.type === 3) {
          const source = (event.data as { source?: number })?.source;
          if (source === 2 || source === 5 || source === 6 || source === 12) {
            hasUserInteraction = true;
            lastInteractionAt = Date.now();
          }
        }

        // JSON.stringify length is a UTF-16 character count, not exact
        // encoded bytes, but it's monotonically tied to the eventual
        // serialized size — close enough for "would adding this event
        // overflow the size cap" and "should we flush yet" decisions.
        const eventBytes = JSON.stringify(scrubbedEvent).length;

        // Pre-push size enforcement: if adding this event would push the
        // buffer over the size cap, flush first so the new event lands at
        // the head of a fresh buffer. Without this the buffer can overshoot
        // (push to 300KB, then trigger a flush — the chunk being flushed is
        // already too big). We only do this once an interaction has
        // happened; pre-interaction flushes no-op inside flushBuffer anyway,
        // and the warm-up phase can otherwise pile up enough mutation
        // events to keep flapping.
        if (
          hasUserInteraction &&
          replayEvents.length > 0 &&
          bufferedBytes + eventBytes > FLUSH_BYTE_SIZE
        ) {
          void flushBuffer();
        }

        // Hard cap is a backstop for the pathological case where all flushes
        // are failing (offline, ingest down) — without it the buffer would
        // grow unboundedly. Under normal conditions the size trigger above
        // fires well before this cap is hit. We drop NEW events rather than
        // evict old ones so the type-2 snapshot at the head of the buffer
        // (required for the player to initialize) is preserved.
        if (replayEvents.length >= MAX_BUFFERED_EVENTS) return;

        replayEvents.push(scrubbedEvent);
        bufferedBytes += eventBytes;
      },
      recordCanvas: false,
      sampling: {
        mousemove: true,
        mouseInteraction: true,
        scroll: 150,
        input: "last",
      },
      // Privacy: GrowthBook's gb-block / gb-mask / gb-ignore class
      // conventions (always honored) plus customer-configured input
      // masking. Defaults to deny-by-default: maskAllInputs is true.
      ...buildRrwebPrivacyOptions(privacy),
    });

    if (!rrwebStop) {
      console.error("rrweb failed to start");
      return;
    }

    stopFn = rrwebStop;
    isRecording = true;

    flushInterval = setInterval(flushBuffer, FLUSH_INTERVAL_MS);
    idleCheckInterval = setInterval(checkAndRotate, 60_000);
    // setInterval is throttled (or frozen entirely) on backgrounded tabs in
    // most browsers, so a tab left idle in the background can blow past
    // MAX_DURATION_MS without the timer firing. Re-evaluate when visibility
    // changes too — gives us a chance to rotate as soon as the user returns.
    document.addEventListener("visibilitychange", onVisibilityChange);
  };

  // Decide whether the current session should be rotated. Called from the
  // periodic interval AND from visibilitychange (see startRecording). Pulled
  // out so both call sites share the same logic.
  const checkAndRotate = () => {
    if (!isRecording) return;
    const now = Date.now();
    const tooLong = now - sessionStartedAt > MAX_DURATION_MS;
    // Idle rotation only applies once we've seen interaction — otherwise we'd
    // loop forever rotating empty sessions on idle tabs. MAX_DURATION_MS is
    // checked unconditionally so background tabs can't escape it.
    const idle =
      hasUserInteraction && now - lastInteractionAt > IDLE_TIMEOUT_MS;
    if (!tooLong && !idle) return;

    stopRecording();
    // Only spin up a fresh session if the previous one had interaction
    // worth recording. Tabs left open all day shouldn't endlessly mint
    // empty session IDs. forceNew=true prevents canResume from restoring
    // the just-stopped session's sessionStartedAt, which would re-trigger
    // tooLong on the very next interval.
    if (hasUserInteraction) startRecording(true);
  };

  const onVisibilityChange = () => {
    if (document.visibilityState === "visible") checkAndRotate();
  };

  const stopRecording = () => {
    if (!isRecording) return;

    // Cancel any pending retry delay. If a retry sleep is active,
    // cancel() rejects the sleep promise as a microtask, which means
    // flushInFlight is still true when the void flushBuffer() call below
    // runs — so that call is a no-op. flushBuffer's finally block detects
    // this case (!isRecording + buffered events) and fires the keepalive
    // flush once the guard is clear. When no retry is in progress, cancel()
    // is a no-op and the void flushBuffer() below fires normally.
    sendWithRetry.cancel();

    // Fire-and-forget the final flush; keepalive in sendChunk lets the
    // browser deliver it even after the recorder is torn down. Awaiting
    // here would block the synchronous shutdown path (onDestroy,
    // checkAndRotate). If a retry cancel is in progress this is a no-op —
    // see the finally block in flushBuffer for the follow-up.
    void flushBuffer();
    stopFn?.();
    stopFn = undefined;
    isRecording = false;

    if (flushInterval !== null) {
      clearInterval(flushInterval);
      flushInterval = null;
    }
    if (idleCheckInterval !== null) {
      clearInterval(idleCheckInterval);
      idleCheckInterval = null;
    }
    document.removeEventListener("visibilitychange", onVisibilityChange);
  };

  return (gb: GrowthBook) => {
    gbRef = gb;
    let cleanedUp = false;

    const [apiHost, key] = gb.getApiInfo();
    host = trackingHost || apiHost;
    clientKey = key;

    // Subscribe to feature evaluations, experiment assignments, and custom
    // events via the SDK's internal plugin hooks. Each callback appends to
    // the plugin's own typed buffer; flushBuffer snapshots and drains those
    // buffers on every chunk send.
    const offFeature = gb._onFeatureEval((featureKey, result) => {
      if (featureEvals.length >= MAX_BUFFERED_EVENTS) featureEvals.shift();
      featureEvals.push({
        featureKey,
        timestamp: Date.now(),
        result: {
          value: result.value,
          experimentKey: result.experiment?.key,
        },
      });
    });

    const offExperiment = gb.subscribe((experiment, result) => {
      if (experimentEvals.length >= MAX_BUFFERED_EVENTS)
        experimentEvals.shift();
      experimentEvals.push({
        key: experiment.key,
        timestamp: Date.now(),
        name: experiment.name,
        result: {
          value: result.value,
          variationId: result.variationId,
          featureId: result.featureId,
        },
      });
    });

    const offEvent = gb._onEvent((eventName, properties) => {
      if (sessionEvents.length >= MAX_BUFFERED_EVENTS) sessionEvents.shift();
      sessionEvents.push({ eventName, timestamp: Date.now(), properties });
    });

    gb._registerSessionReplay(startRecording, stopRecording);

    if (autoRecord) startRecording();

    const onPageHide = () => void flushBuffer();
    const onVisibilityHide = () => {
      if (document.visibilityState === "hidden") void flushBuffer();
    };

    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisibilityHide);

    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      offFeature();
      offExperiment();
      offEvent();
      stopRecording();
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibilityHide);
      gb._unregisterSessionReplay(startRecording, stopRecording);
    };

    gb.onDestroy(cleanup);

    return cleanup;
  };
}
