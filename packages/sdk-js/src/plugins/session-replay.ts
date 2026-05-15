import { record } from "rrweb";
import type { eventWithTime } from "@rrweb/types";
import { GrowthBook } from "../GrowthBook";
import {
  SessionReplayPrivacyConfig,
  buildRrwebPrivacyOptions,
} from "./session-replay-privacy";
import { scrubEventUrls } from "./session-replay-url-scrub";
import { scrubEventsPayload } from "./session-replay-regex-scrub";

export type {
  SessionReplayPrivacyConfig,
  MaskableInputType,
  SessionReplayUrlScrubberConfig,
  SessionReplayRegexScrubberConfig,
} from "./session-replay-privacy";
export {
  GB_BLOCK_CLASS,
  GB_MASK_CLASS,
  GB_IGNORE_CLASS,
} from "./session-replay-privacy";
export { scrubUrl } from "./session-replay-url-scrub";
export { scrubEventsPayload } from "./session-replay-regex-scrub";

type PluginOptions = {
  trackingHost?: string;
  autoRecord?: boolean;
  /**
   * Per-app kill switch. When false, the plugin loads but never starts
   * recording. Customers can flip this at runtime to suppress capture
   * (e.g. while a user is on a known-sensitive route). The server-side
   * per-org kill switch is enforced separately on the ingest endpoint.
   *
   * Default: true.
   */
  enabled?: boolean;
  /**
   * How long (ms) the user can be idle before the current session is
   * finalized and a new one started. Idle = no mouse, keyboard, scroll,
   * or touch events. Default: 15 minutes.
   */
  idleTimeoutMs?: number;
  /**
   * Hard cap (ms) on a single session's wall-clock length. When exceeded
   * the session is finalized and a new one begins automatically.
   * Default: 30 minutes.
   */
  maxDurationMs?: number;
  /**
   * Privacy controls for what rrweb captures. Element-level privacy is
   * fully driven by GrowthBook's three shipped class names —
   * `gb-block`, `gb-mask`, and `gb-ignore` — and is not configurable
   * here; this option only covers input masking strategy and custom
   * transform hooks. Defaults to deny-by-default (every input masked).
   */
  privacy?: SessionReplayPrivacyConfig;
  /**
   * Periodic flush cadence (ms). Flushes also fire when the buffer
   * reaches `flushEventCount` or `flushByteSize`, whichever happens
   * first — this is the upper bound on how stale buffered events can
   * be before being shipped. Stretching this longer reduces request
   * volume and improves gzip ratios at the cost of more potential
   * data loss on a crash/close.
   * Default: 60_000 (60s).
   */
  flushIntervalMs?: number;
  /**
   * Trigger an early flush once the buffer reaches this many events.
   * Acts as a count-based escape hatch so highly active sessions don't
   * sit on a large unsent buffer for the full flush interval. Must be
   * less than `maxBufferedEvents`.
   * Default: 150.
   */
  flushEventCount?: number;
  /**
   * Trigger an early flush once the approximate serialized size of the
   * buffer exceeds this many bytes. Computed as the running sum of
   * `JSON.stringify(event).length` since the last flush; not exact
   * (JS strings are UTF-16) but a close enough upper-bound estimate to
   * keep payloads comfortably under the ingest endpoint's 10MB limit.
   * Default: 262_144 (256KB).
   */
  flushByteSize?: number;
  /**
   * Hard cap on the in-memory event buffer. New events are dropped
   * once the cap is hit so the buffer can't grow without bound if
   * every flush is failing (e.g. user offline). Should be > `flushEventCount`
   * — under normal conditions a flush will fire well before this cap
   * is reached.
   * Default: 500.
   */
  maxBufferedEvents?: number;
  /**
   * Gzip the request body via the browser's native `CompressionStream`
   * before POSTing. When `CompressionStream` is unavailable
   * (older Safari, etc.) or compression throws, falls back to sending
   * uncompressed JSON. The ingest endpoint sees `Content-Encoding: gzip`
   * and `express.json` inflates transparently — no server change
   * required.
   * Default: true.
   */
  compress?: boolean;
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

declare global {
  interface Window {
    _gbReplayEvents: eventWithTime[];
    _gbGetReplayEvents: (options?: {
      minTimestamp?: number;
      maxTimestamp?: number;
    }) => eventWithTime[];
  }
}

function generateSessionId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function sessionReplayPlugin({
  trackingHost = "",
  autoRecord = true,
  enabled = true,
  idleTimeoutMs = 15 * 60 * 1000,
  maxDurationMs = 30 * 60 * 1000,
  privacy,
  flushIntervalMs = 60_000,
  flushEventCount = 150,
  flushByteSize = 256 * 1024,
  maxBufferedEvents = 500,
  compress = true,
}: PluginOptions = {}) {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("sessionReplayPlugin only works in the browser");
  }

  let gbRef: GrowthBook | null = null;
  let host = "";
  let clientKey = "";

  let stopFn: (() => void) | undefined;
  let isRecording = false;
  let sessionId = "";
  let chunkIndex = 0;
  let hasUserInteraction = false;
  let sessionStartedAt = 0;
  let lastInteractionAt = 0;
  let logCursor = 0;
  let flushInterval: ReturnType<typeof setInterval> | null = null;
  let idleCheckInterval: ReturnType<typeof setInterval> | null = null;
  // Running estimate of the buffer's serialized size in bytes, used by the
  // size-based flush trigger. Reset whenever the buffer is cleared. This is
  // an upper-bound approximation — JSON string lengths count UTF-16 code
  // units, not actual encoded bytes — but it's cheap to maintain (one
  // JSON.stringify per emitted event) and good enough to keep payloads
  // under the ingest endpoint's body-size limit.
  let bufferedBytes = 0;

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
      const compressed = inputStream.pipeThrough(
        new CompressionStream("gzip"),
      );
      return await new Response(compressed).blob();
    } catch {
      return null;
    }
  };

  /**
   * Fire-and-forget upload of one already-serialized chunk. Runs the gzip
   * step asynchronously, but the caller (flushBuffer) has already cleared
   * the buffer synchronously so new events can't be lost to a race between
   * snapshot and clear.
   */
  const sendChunk = async (payload: string): Promise<void> => {
    let body: BodyInit = payload;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (compress) {
      const gz = await gzipString(payload);
      if (gz) {
        body = gz;
        headers["Content-Encoding"] = "gzip";
      }
    }
    // Use a regular fetch — even compressed, payloads can exceed
    // sendBeacon/keepalive limits.
    fetch(`${host}/ingest/session-replay`, {
      method: "POST",
      headers,
      body,
    }).catch(() => {
      // best-effort
    });
  };

  const flushBuffer = () => {
    if (!gbRef || window._gbReplayEvents?.length === 0) return;
    // First chunk must contain a full snapshot so the player can initialize
    if (chunkIndex === 0 && !window._gbReplayEvents.some((e) => e.type === 2))
      return;
    // Don't flush sessions with no real user interaction (filters out hot-reload noise)
    if (!hasUserInteraction) return;

    const evaluatedExperiments = Array.from(
      gbRef.getAllResults().entries(),
    ).reduce(
      (acc, [key, { result }]) => {
        // `result` is a Result<T>; variationId lives at the top level, not on
        // `result.value` (which is the variation's payload of type T). Reading
        // `result.value.variationId` returned undefined for every entry, which
        // JSON.stringify drops — leaving experiments as `"{}"` in the payload.
        acc[key] = result.variationId;
        return acc;
      },
      {} as Record<string, number>,
    );

    const flags: Record<string, unknown> = {};
    gbRef.logs?.forEach?.((log) => {
      if (log.logType === "feature") {
        flags[log.featureKey] = log.result.value;
      }
    });

    const context = {
      attributes: JSON.stringify(gbRef.getAttributes()),
      experiments: JSON.stringify(evaluatedExperiments),
      flags: JSON.stringify(flags),
    };

    const replayEvents = [...window._gbReplayEvents];
    const minTimestamp = replayEvents.reduce(
      (min, event) => Math.min(min, event.timestamp),
      Number.POSITIVE_INFINITY,
    );
    const maxTimestamp = replayEvents.reduce(
      (max, event) => Math.max(max, event.timestamp),
      Number.NEGATIVE_INFINITY,
    );

    const events = window
      ._gbGetReplayEvents({
        minTimestamp:
          minTimestamp === Number.POSITIVE_INFINITY
            ? sessionStartedAt
            : minTimestamp,
        maxTimestamp:
          maxTimestamp === Number.NEGATIVE_INFINITY ? Date.now() : maxTimestamp,
      })
      .sort((a, b) => a.timestamp - b.timestamp);

    // Pre-transmission regex scrubbing — last line of defense. Replaces
    // credit-card / SSN / email-shaped strings (and any customer-supplied
    // patterns) with [REDACTED] anywhere they appear in the event tree,
    // even fields rrweb's masking doesn't know about (custom event data,
    // tooltip text, error messages, etc.). Pass `regex: false` in the
    // privacy config to opt out — not recommended.
    const scrubbedEvents =
      privacy?.regex === false
        ? events
        : scrubEventsPayload(events, privacy?.regex ?? {});

    const payload = JSON.stringify({
      clientKey,
      sessionId,
      chunkIndex,
      sessionStartedAt,
      events: scrubbedEvents,
      context,
    });

    // Clear the buffer SYNCHRONOUSLY before any await, so emits arriving
    // while gzip is in flight land in a fresh buffer instead of being lost
    // to a "clear-after-await" race. The previous chunkIndex is already
    // baked into `payload`, so it's safe to increment here.
    chunkIndex++;
    window._gbReplayEvents.length = 0;
    bufferedBytes = 0;

    void sendChunk(payload);
  };

  const startRecording = () => {
    if (isRecording) return;

    // Customer-side kill switch — set enabled: false on the plugin to
    // suppress capture for this user/app instance.
    if (!enabled) return;

    // Honor browser-level Do Not Track / Global Privacy Control signals.
    // GPC is binding under California's CCPA/CPRA; DNT is courtesy. We
    // bail BEFORE rrweb starts so no events are even generated.
    if (userOptedOutOfTracking()) return;

    // Fresh session state for each start
    sessionId = generateSessionId();
    chunkIndex = 0;
    hasUserInteraction = false;
    sessionStartedAt = Date.now();
    lastInteractionAt = Date.now();
    logCursor = gbRef?.logs?.length ?? 0;
    window._gbReplayEvents = [];
    bufferedBytes = 0;

    const rrwebStop = record({
      emit(event: eventWithTime) {
        // Scrub URL fields BEFORE the event lands in the buffer so any
        // downstream observer (the buffer itself, the flush payload, an
        // attacker who somehow reads window._gbReplayEvents) only ever
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

        // Hard cap is a backstop for the pathological case where all flushes
        // are failing (offline, ingest down) — without it the buffer would
        // grow unboundedly. Under normal conditions the count/byte triggers
        // below will fire well before this cap is hit. We drop NEW events
        // rather than evict old ones so the type-2 snapshot at the head of
        // the buffer (required for the player to initialize) is preserved.
        if (window._gbReplayEvents.length >= maxBufferedEvents) return;

        window._gbReplayEvents.push(scrubbedEvent);
        // JSON.stringify length is a UTF-16 character count, not exact
        // encoded bytes, but it's monotonically tied to the eventual
        // serialized size — close enough for a "should we flush yet"
        // threshold check.
        bufferedBytes += JSON.stringify(scrubbedEvent).length;

        // Pre-interaction flushes always no-op inside flushBuffer, so skip
        // the trigger entirely to avoid wasted calls during the warm-up
        // phase (which can pile up a lot of mutation events before the
        // first click).
        if (!hasUserInteraction) return;
        if (
          window._gbReplayEvents.length >= flushEventCount ||
          bufferedBytes >= flushByteSize
        ) {
          flushBuffer();
        }
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

    flushInterval = setInterval(flushBuffer, flushIntervalMs);
    idleCheckInterval = setInterval(checkAndRotate, 60_000);
    // setInterval is throttled (or frozen entirely) on backgrounded tabs in
    // most browsers, so a tab left idle in the background can blow past
    // maxDurationMs without the timer firing. Re-evaluate when visibility
    // changes too — gives us a chance to rotate as soon as the user returns.
    document.addEventListener("visibilitychange", onVisibilityChange);
  };

  // Decide whether the current session should be rotated. Called from the
  // periodic interval AND from visibilitychange (see startRecording). Pulled
  // out so both call sites share the same logic.
  const checkAndRotate = () => {
    if (!isRecording) return;
    const now = Date.now();
    const tooLong = now - sessionStartedAt > maxDurationMs;
    // Idle rotation only applies once we've seen interaction — otherwise we'd
    // loop forever rotating empty sessions on idle tabs. maxDuration is
    // checked unconditionally so background tabs can't escape it.
    const idle = hasUserInteraction && now - lastInteractionAt > idleTimeoutMs;
    if (!tooLong && !idle) return;

    stopRecording();
    // Only spin up a fresh session if the previous one had interaction
    // worth recording. Tabs left open all day shouldn't endlessly mint
    // empty session IDs.
    if (hasUserInteraction) startRecording();
  };

  const onVisibilityChange = () => {
    if (document.visibilityState === "visible") checkAndRotate();
  };

  const stopRecording = () => {
    if (!isRecording) return;

    flushBuffer();
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
    gb.setCaptureLogs(true);

    const [apiHost, key] = gb.getApiInfo();
    host = trackingHost || apiHost;
    clientKey = key;

    window._gbReplayEvents = window._gbReplayEvents || [];
    window._gbGetReplayEvents = (options) => {
      const customEvents: eventWithTime[] = [];
      const logs = gb.logs || [];
      const nextLogs = logs.slice(logCursor);
      logCursor = logs.length;
      nextLogs.forEach((log) => {
        const timestamp = parseInt(log.timestamp);
        if (!Number.isFinite(timestamp)) return;
        if (
          options?.minTimestamp !== undefined &&
          timestamp < options.minTimestamp
        ) {
          return;
        }
        if (
          options?.maxTimestamp !== undefined &&
          timestamp > options.maxTimestamp
        ) {
          return;
        }
        if (log.logType === "feature") {
          customEvents.push({
            type: 5,
            timestamp,
            data: {
              tag: "feature-flag",
              payload: {
                id: log.featureKey,
                value: log.result.value,
              },
            },
          });
        } else if (log.logType === "experiment") {
          customEvents.push({
            type: 5,
            timestamp,
            data: {
              tag: "experiment",
              payload: {
                id: log.experiment.key,
                variation: log.result.variationId,
              },
            },
          });
        }
      });

      return [...window._gbReplayEvents, ...customEvents];
    };

    gb._registerSessionReplay(startRecording, stopRecording);

    if (autoRecord) startRecording();

    window.addEventListener("pagehide", flushBuffer);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flushBuffer();
    });

    gb.onDestroy(() => {
      stopRecording();
    });
  };
}
