import { record } from "rrweb";
import type { eventWithTime } from "@rrweb/types";
import type { SessionReplaySettings } from "../../types/growthbook";
import type { GrowthBook } from "../../GrowthBook";
import { readSessionJSON, writeSessionJSON } from "../utils/storage";
import { resolveSessionId } from "../utils/session";
import { shouldSampleScope, persistSampleDecision } from "../utils/sampling";
import { mergeSettings } from "../utils/settings";
import { DEFAULT_INGESTOR_HOST } from "../utils/ingestor";
import { resolvePrivacySettings } from "../utils/privacy";
import { createRetry, RetryExhaustedError, RetryCancelledError } from "./retry";
import {
  buildRrwebPrivacyOptions,
  type SessionReplayPrivacySettings,
} from "./privacy";
import { scrubEventUrls } from "./url-scrub";
import {
  getOrCreateSessionReplayId,
  SESSION_REPLAY_IDLE_TIMEOUT_MS,
} from "./id";

export type SessionReplayOptions = {
  ingestorHost?: string;
  autoRecord?: boolean;
  // Kill switch: when false, the plugin loads but never records. Default true.
  enabled?: boolean;
  // Fraction of sessions to record (0-1, default 1). True-random and sticky
  // per replay session.
  samplingRate?: number;
  // What rrweb may capture. Deny by default (every input masked); keys
  // omitted here inherit whatever autoEventsPlugin({ privacy }) was given.
  privacy?: SessionReplayPrivacySettings;
};

export type ReplayRecorderSettings = SessionReplayOptions & {
  growthbook: GrowthBook;
};

const SAMPLE_DECISION_KEY = "gb_session_replay_sampled";

const DEFAULT_SETTINGS: Required<SessionReplaySettings> = {
  enabled: true,
  samplingRate: 1,
};

// Do Not Track / Global Privacy Control (CCPA-binding), checked before
// rrweb starts so no events are generated at all
function userOptedOutOfTracking(): boolean {
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

// Max idle gap before a cross-reload resume is rejected. Must match the
// replay id's idle timeout or a resume could reset chunkIndex to 0 under
// the same session_replay_id — a chunk-0 collision.
const RESUME_STALENESS_MS = SESSION_REPLAY_IDLE_TIMEOUT_MS;

function readPersistedReplayState(): PersistedReplayState | null {
  const parsed = readSessionJSON(
    REPLAY_STORAGE_KEY,
  ) as PersistedReplayState | null;
  if (!parsed) return null;
  const sessionReplayId =
    typeof parsed.sessionReplayId === "string" ? parsed.sessionReplayId : "";
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
}

// Failures are ignored: without storage, resume-across-reloads won't work
// but within-page recording is unaffected.
function writePersistedReplayState(state: PersistedReplayState): void {
  writeSessionJSON(REPLAY_STORAGE_KEY, state);
}

const errorStatus = (e: unknown): number | undefined =>
  e && typeof e === "object" ? (e as { status?: number }).status : undefined;

// Exponential back-off for retriable sends (5xx / 429 / network).
const RETRY_BASE_DELAY_MS = 1_000;
const RETRY_MAX_DELAY_MS = 30_000;
const RETRY_MAX_ATTEMPTS = 5;
const RETRY_JITTER_MS = 500;

// Finalize a recording after this much inactivity
const IDLE_TIMEOUT_MS = 15 * 60 * 1000;
// Hard cap on one recording's wall-clock length, even while active
const MAX_DURATION_MS = 30 * 60 * 1000;
const FLUSH_INTERVAL_MS = 60_000;
// Flush threshold, sized so gzipped chunks (~8-15x) stay under fetch
// keepalive's 64KB body limit and unload flushes deliver
const FLUSH_BYTE_SIZE = 256 * 1024;
// Backstop when every flush is failing (offline); new events are dropped
const MAX_BUFFERED_EVENTS = 500;
const COMPRESS_REQUESTS = true;

export function createReplayRecorder({
  ingestorHost,
  autoRecord = true,
  enabled,
  samplingRate,
  privacy,
  growthbook,
}: ReplayRecorderSettings) {
  // Remote re-enables resume recording only if nothing stopped it explicitly
  let autoRestart = autoRecord;

  // defaults ← constructor options ← remote sdkSettings from the payload.
  // A local `enabled: false` is definitive: remote settings can turn a
  // locally-enabled plugin off, never on.
  const resolveSettings = (): Required<SessionReplaySettings> => {
    const sdkSettings = growthbook.getDecryptedPayload().sdkSettings;
    const remote = sdkSettings ? sdkSettings.sessionReplay : undefined;
    const settings = mergeSettings(
      DEFAULT_SETTINGS,
      { enabled, samplingRate },
      remote,
    );
    // Missing on either side means "no opinion", not off
    const remoteEnabled = remote ? remote.enabled : undefined;
    settings.enabled = (enabled ?? true) && (remoteEnabled ?? true);
    return settings;
  };
  const host = ingestorHost || DEFAULT_INGESTOR_HOST;
  const clientKey = growthbook.getApiInfo()[1];

  let stopFn: (() => void) | undefined;
  let isRecording = false;
  let sessionReplayId = "";
  let chunkIndex = 0;
  let hasUserInteraction = false;
  let sessionStartedAt = 0;
  let viewportWidth = 0;
  let viewportHeight = 0;
  let lastInteractionAt = 0;
  // Guards concurrent flush triggers from racing the buffer snapshot/clear
  // and double-sending events
  let flushInFlight = false;
  let flushInterval: ReturnType<typeof setInterval> | null = null;
  let idleCheckInterval: ReturnType<typeof setInterval> | null = null;
  // Upper-bound estimate of the buffer's serialized size
  let bufferedBytes = 0;
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

  // Gzip via native CompressionStream; null when unavailable (caller falls
  // back to the raw payload).
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

  // Throws on network failure or non-2xx so flushBuffer can revert and
  // retry — losing chunk 0 (the FullSnapshot) makes a session unplayable
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

  // Back off and retry on 5xx/429/network; permanent 4xx are not retried
  const sendWithRetry = createRetry(
    {
      baseDelayMs: RETRY_BASE_DELAY_MS,
      maxDelayMs: RETRY_MAX_DELAY_MS,
      maxAttempts: RETRY_MAX_ATTEMPTS,
      jitterMs: RETRY_JITTER_MS,
      isRetriable: (e) => {
        const status = errorStatus(e);
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
    // Re-entrancy guard — events accumulated while a flush is awaiting its
    // response get picked up by the next trigger
    if (flushInFlight) return;

    if (!replayEvents.length) return;
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
      const attrs = growthbook.getAttributes();
      const userIdAttr = attrs.user_id;
      const deviceIdAttr = attrs.device_id || attrs.anonymous_id || attrs.id;
      const context = {
        attributes: JSON.stringify(attrs),
        ...(typeof userIdAttr === "string" && { user_id: userIdAttr }),
        ...(typeof deviceIdAttr === "string" && { device_id: deviceIdAttr }),
      };

      // rrweb custom events (type 5) let the player show feature/experiment
      // panels at the timestamp they occurred
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

      // Same precedence as the tracking plugin's session_id column, so the
      // replay↔events join key can't diverge
      const sessionId = resolveSessionId(attrs);

      const payload = JSON.stringify({
        clientKey,
        session_replay_id: sessionReplayId,
        ...(sessionId && { gb_session_id: sessionId }),
        chunkIndex: chunkIndexBeingSent,
        sessionStartedAt,
        viewport: { width: viewportWidth, height: viewportHeight },
        events,
        context,
        featureEvals: { items: featureEvalsBeingSent },
        experimentEvals: { items: experimentEvalsBeingSent },
        sessionEvents: { items: sessionEventsBeingSent },
      });

      // Clear synchronously so mid-flight emits land in a fresh buffer;
      // chunkIndex only advances once the send is acknowledged
      replayEvents.length = 0;
      bufferedBytes = 0;

      try {
        await sendWithRetry(payload);
        // Commit the advance only if the session didn't rotate mid-flight
        // (a new session restarts its own chunkIndex at 0)
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
        // Rotated mid-flight — the chunk belongs to a session that's gone, so
        // it must never be restored into the new session's buffer
        if (sessionReplayId !== sessionReplayIdBeingSent) {
          console.warn(
            `session-replay: chunk ${chunkIndexBeingSent} lost during session rotation`,
            e,
          );
          return;
        }

        if (e instanceof RetryCancelledError) {
          // stopRecording cancelled a pending retry — restore the snapshot
          // for its final keepalive flush
          replayEvents.unshift(...eventsBeingSent);
          bufferedBytes += bufferedBytesBeingSent;
          featureEvals.unshift(...featureEvalsBeingSent);
          experimentEvals.unshift(...experimentEvalsBeingSent);
          sessionEvents.unshift(...sessionEventsBeingSent);
          return;
        }

        if (e instanceof RetryExhaustedError) {
          // Chunk is permanently lost; keep recording rather than stalling
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

        // Permanent 4XX — the payload or credentials are unrecoverable
        const status = errorStatus(e);
        if (status === 401 || status === 403) {
          // A bad clientKey won't fix itself within the page load; stop so
          // pagehide doesn't fire one last POST against the same bad key
          console.error(
            `session-replay: stopping recorder after HTTP ${status}. ` +
              "Verify your GrowthBook clientKey and that the org has " +
              "session replay enabled on the ingestor.",
            e,
          );
          replayEvents.length = 0;
          bufferedBytes = 0;
          autoRestart = false;
          stopRecording();
          return;
        }
        // Other 4XX: skip the chunk and keep recording
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
      // stopRecording's own flush call no-ops while a cancelled retry holds
      // the guard; fire the final keepalive flush for it here
      if (!isRecording && replayEvents.length) {
        void flushBuffer();
      }
    }
  };

  // forceNew skips the resume check — resuming a rotated-out session's
  // sessionStartedAt would re-trip tooLong every interval. force bypasses
  // sampling (programmatic gb.startSessionReplay()), never the kill switch.
  const startRecording = (forceNew = false, force = false) => {
    if (isRecording) return;
    const settings = resolveSettings();
    if (!settings.enabled) return;
    if (userOptedOutOfTracking()) return;
    const resolvedPrivacy = resolvePrivacySettings({}, privacy);

    const persisted = readPersistedReplayState();
    const now = Date.now();
    const nextSessionReplayId = getOrCreateSessionReplayId(forceNew);
    if (!nextSessionReplayId) return;

    if (force) {
      // Sticky, so reloads within a forced session keep recording
      persistSampleDecision(SAMPLE_DECISION_KEY, nextSessionReplayId, true);
    } else if (
      !shouldSampleScope({
        rate: settings.samplingRate,
        storageKey: SAMPLE_DECISION_KEY,
        scopeId: nextSessionReplayId,
      })
    ) {
      return;
    }

    void growthbook.updateAttributes({
      session_replay_id: nextSessionReplayId,
    });

    // Resume only the same logical replay session with a recent-enough last
    // chunk; forceNew rotations always start fresh
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

    // Snapshot viewport once at start — re-reading per chunk would be
    // inconsistent if the user resizes mid-session
    viewportWidth = window.innerWidth || 0;
    viewportHeight = window.innerHeight || 0;

    hasUserInteraction = false;
    lastInteractionAt = Date.now();
    replayEvents = [];
    bufferedBytes = 0;

    const rrwebStop = record({
      emit(event: eventWithTime) {
        // Scrub URL fields before the event lands in the buffer so nothing
        // downstream ever sees an unsanitized version
        const scrubbedEvent = scrubEventUrls(event, resolvedPrivacy.url);

        // Only deliberate input (rrweb IncrementalSource 2=MouseInteraction,
        // 5=Input, 6=TouchMove, 12=Drag) counts as interaction; checked
        // before the buffer cap so a dropped event still flips the flag
        if (event.type === 3) {
          const source = event.data
            ? (event.data as { source?: number }).source
            : undefined;
          if (source === 2 || source === 5 || source === 6 || source === 12) {
            hasUserInteraction = true;
            lastInteractionAt = Date.now();
          }
        }

        // UTF-16 length, not exact bytes — close enough for cap decisions
        const eventBytes = JSON.stringify(scrubbedEvent).length;

        // Flush before the event that would overflow the cap so chunks
        // never overshoot; pre-interaction flushes would no-op anyway
        if (
          hasUserInteraction &&
          replayEvents.length > 0 &&
          bufferedBytes + eventBytes > FLUSH_BYTE_SIZE
        ) {
          void flushBuffer();
        }

        if (replayEvents.length >= MAX_BUFFERED_EVENTS) {
          // Flushes are failing: drop new events rather than the snapshot
          if (hasUserInteraction) return;
          // Nothing has shipped yet, so dropping mutations would desync the
          // replay; restart the buffer from a fresh snapshot instead
          replayEvents = [];
          bufferedBytes = 0;
          typeof record.takeFullSnapshot === "function" &&
            record.takeFullSnapshot();
          return;
        }

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
      ...buildRrwebPrivacyOptions(resolvedPrivacy),
    });

    if (!rrwebStop) {
      console.error("rrweb failed to start");
      return;
    }

    stopFn = rrwebStop;
    isRecording = true;

    flushInterval = setInterval(flushBuffer, FLUSH_INTERVAL_MS);
    idleCheckInterval = setInterval(checkAndRotate, 60_000);
    // Background tabs throttle/freeze timers, so also re-check when the
    // user returns
    document.addEventListener("visibilitychange", onVisibilityChange);
  };

  const checkAndRotate = () => {
    if (!isRecording) return;
    const now = Date.now();
    const tooLong = now - sessionStartedAt > MAX_DURATION_MS;
    // Idle rotation needs prior interaction, else idle tabs would loop
    // rotating empty sessions; the hard cap applies unconditionally
    const idle =
      hasUserInteraction && now - lastInteractionAt > IDLE_TIMEOUT_MS;
    if (!tooLong && !idle) return;

    stopRecording();
    // Only restart if the previous session was worth recording; forceNew
    // prevents resuming the just-stopped session's sessionStartedAt
    if (hasUserInteraction) startRecording(true);
  };

  const onVisibilityChange = () => {
    if (document.visibilityState === "visible") checkAndRotate();
  };

  const stopRecording = () => {
    if (!isRecording) return;

    // Cancelling an active retry leaves flushInFlight true (the flush below
    // no-ops); flushBuffer's finally block re-fires it once the guard clears
    sendWithRetry.cancel();

    // Fire-and-forget: keepalive delivers after teardown, and awaiting would
    // block the synchronous shutdown path (onDestroy, checkAndRotate)
    void flushBuffer();
    stopFn && stopFn();
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

  let cleanedUp = false;

  // Eval/event subscriptions append to typed buffers that flushBuffer
  // drains on every chunk send
  const offFeature = growthbook._subscribeFeatureUsage((featureKey, result) => {
    if (featureEvals.length >= MAX_BUFFERED_EVENTS) featureEvals.shift();
    featureEvals.push({
      featureKey,
      timestamp: Date.now(),
      result: {
        value: result.value,
        experimentKey: result.experiment ? result.experiment.key : undefined,
      },
    });
  });

  const offExperiment = growthbook.subscribe((experiment, result) => {
    if (experimentEvals.length >= MAX_BUFFERED_EVENTS) experimentEvals.shift();
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

  const offEvent = growthbook._subscribeCustomEvents(
    (eventName, properties) => {
      if (sessionEvents.length >= MAX_BUFFERED_EVENTS) sessionEvents.shift();
      sessionEvents.push({ eventName, timestamp: Date.now(), properties });
    },
  );

  const forceStart = () => {
    autoRestart = true;
    startRecording(false, true);
  };
  const explicitStop = () => {
    autoRestart = false;
    stopRecording();
  };
  growthbook._registerSessionReplay(forceStart, explicitStop);

  // Remote settings apply mid-recording: the kill switch stops in-flight
  // recordings; re-enabling resumes unless something stopped it explicitly
  const offPayload = growthbook._subscribePayloadUpdates(() => {
    const settings = resolveSettings();
    if (!settings.enabled && isRecording) {
      stopRecording();
    } else if (settings.enabled && autoRestart && !isRecording) {
      startRecording();
    }
  });

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
    offPayload();
    stopRecording();
    window.removeEventListener("pagehide", onPageHide);
    document.removeEventListener("visibilitychange", onVisibilityHide);
    growthbook._unregisterSessionReplay(forceStart, explicitStop);
  };

  growthbook.onDestroy(cleanup);

  return cleanup;
}
