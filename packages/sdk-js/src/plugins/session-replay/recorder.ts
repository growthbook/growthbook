import { record } from "rrweb";
import type { eventWithTime } from "rrweb";
import type { SessionReplaySettings } from "../../types/growthbook";
import type { GrowthBook } from "../../GrowthBook";
import { readSessionJSON, writeSessionJSON } from "../utils/storage";
import { resolveSessionId } from "../utils/session";
import {
  normalizeSamplingRate,
  persistSampleDecision,
  shouldSampleScope,
} from "../utils/sampling";
import { mergeSettings } from "../utils/settings";
import { DEFAULT_INGESTOR_HOST } from "../utils/ingestor";
import { resolvePrivacySettings } from "../utils/privacy";
import { runWhenIdle, runWhenIdleAfterLoad } from "../utils/browser";
import { createRetry, RetryExhaustedError, RetryCancelledError } from "./retry";
import {
  buildRrwebPrivacyOptions,
  type SessionReplayPrivacySettings,
} from "./privacy";
import { scrubEventUrls } from "./url-scrub";
import {
  registerSessionReplay,
  unregisterSessionReplay,
  type SessionReplayApi,
} from "./controls";
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
  startMode?: "idle" | "immediate";
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
const FLUSH_BYTE_SIZE = 512 * 1024;
// Backstop when every flush is failing (offline); new events are dropped
const MAX_BUFFERED_EVENTS = 1000;
const MAX_PRE_INTERACTION_BYTES = 2 * 1024 * 1024;
const MAX_REJECTED_SNAPSHOTS = 3;
const REARM_EVENTS = ["pointerdown", "keydown", "touchstart"] as const;

export type SerializedEvent = { type: number; timestamp: number; json: string };

export function serializeEvent(event: eventWithTime): SerializedEvent {
  return {
    type: event.type,
    timestamp: event.timestamp,
    json: JSON.stringify(event),
  };
}

// Splits events into batches where each batch's cumulative serialized size
// stays under maxBytes. A single event larger than maxBytes still goes in its
// own batch — we never split individual events.
export function partitionEvents<T extends { type: number }>(
  events: T[],
  maxBytes: number = FLUSH_BYTE_SIZE,
  isolateSnapshot: boolean = false,
  sizeOf: (event: T) => number = (event) => JSON.stringify(event).length,
): T[][] {
  const batches: T[][] = [];
  let current: T[] = [];
  let currentSize = 0;
  let snapshotSeen = !isolateSnapshot;
  for (const event of events) {
    const eventSize = sizeOf(event);
    if (
      snapshotSeen &&
      current.length > 0 &&
      currentSize + eventSize > maxBytes
    ) {
      batches.push(current);
      current = [event];
      currentSize = eventSize;
    } else {
      current.push(event);
      currentSize += eventSize;
    }
    // Force a batch break after the snapshot so chunk 0 contains only the
    // snapshot (+ preceding meta events), keeping it small
    if (!snapshotSeen && event.type === 2) {
      snapshotSeen = true;
      batches.push(current);
      current = [];
      currentSize = 0;
    }
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

export function createReplayRecorder({
  ingestorHost,
  autoRecord = true,
  enabled,
  samplingRate,
  privacy,
  startMode = "idle",
  growthbook,
}: ReplayRecorderSettings) {
  // Remote re-enables resume recording only if nothing stopped it explicitly
  let autoRestart = autoRecord;
  let resolvedPrivacy: SessionReplayPrivacySettings = {};

  // defaults ← constructor options ← remote sdkSettings from the payload.
  // Remote overrides local, except a local `enabled: false`, which is
  // definitive.
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
    settings.samplingRate = normalizeSamplingRate(
      remote ? remote.samplingRate : undefined,
      normalizeSamplingRate(
        samplingRate,
        1,
        "sessionReplayPlugin: samplingRate",
      ),
      "sdkSettings.sessionReplay.samplingRate",
    );
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
  let replayEvents: SerializedEvent[] = [];
  // Bytes buffered besides the snapshot, for the pre-interaction cap
  let preInteractionBytes = 0;
  // Cancels a deferred start that hasn't run yet
  let cancelScheduledStart: (() => void) | null = null;
  // Removes the listeners of a recorder paused until the first interaction
  let disarmInteractionRestart: (() => void) | null = null;
  // Set between deciding to pause (inside rrweb's emit) and the pause itself
  let pausePending = false;
  // Bumped on every start so a stale pause can't stop a newer recording
  let recordingGeneration = 0;
  let rejectedSnapshots = 0;
  let sawPreStartInteraction = false;
  let disarmPreStartLatch: (() => void) | null = null;

  const featureEvals: Array<{
    featureKey: string;
    timestamp: number;
    result: { value: unknown; experimentKey?: string };
  }> = [];
  const experimentEvals: Array<{
    key: string;
    timestamp: number;
    name?: string;
    result: {
      value: unknown;
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
    const gz = await gzipString(payload);
    if (gz) {
      body = gz;
      headers["Content-Encoding"] = "gzip";
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

    const attrs = growthbook.getAttributes();
    let context: { attributes: string; user_id?: string; device_id?: string };
    let sessionEventsRedacted: typeof sessionEvents;
    try {
      const userIdAttr = attrs.user_id;
      const deviceIdAttr = attrs.device_id || attrs.anonymous_id || attrs.id;
      const redactAttrs = resolvedPrivacy.redactAttributes;
      context = {
        attributes: JSON.stringify(redactAttrs ? redactAttrs(attrs) : attrs),
        ...(typeof userIdAttr === "string" && { user_id: userIdAttr }),
        ...(typeof deviceIdAttr === "string" && { device_id: deviceIdAttr }),
      };

      const redactProps = resolvedPrivacy.redactEventProperties;
      // Copied, never aliased: the live buffer is spliced just below
      sessionEventsRedacted = redactProps
        ? sessionEvents.map((e) =>
            e.properties
              ? { ...e, properties: redactProps(e.eventName, e.properties) }
              : e,
          )
        : [...sessionEvents];
    } catch (e) {
      console.error(
        "session-replay: privacy redaction failed; events stay buffered for " +
          "the next flush",
        e,
      );
      return;
    }

    flushInFlight = true;

    const sessionReplayIdBeingSent = sessionReplayId;
    const sessionStartedAtBeingSent = sessionStartedAt;
    const viewportBeingSent = { width: viewportWidth, height: viewportHeight };
    let nextChunkIndex = chunkIndex;
    const totalBufferedBytes = bufferedBytes;
    const eventsBeingSent = [...replayEvents];
    const featureEvalsBeingSent = featureEvals.splice(0);
    const experimentEvalsBeingSent = experimentEvals.splice(0);
    const sessionEventsBeingSent = sessionEvents.splice(0);

    // Clear the live buffer synchronously before awaiting so emits arriving
    // mid-flight land in a fresh buffer
    replayEvents.length = 0;
    bufferedBytes = 0;

    try {
      // rrweb custom events (type 5) let the player show feature/experiment
      // panels at the timestamp they occurred — merge before partitioning so
      // they distribute across batches by timestamp
      const customEvents: SerializedEvent[] = [];
      featureEvalsBeingSent.forEach((fe) => {
        customEvents.push(
          serializeEvent({
            type: 5,
            timestamp: fe.timestamp,
            data: {
              tag: "feature-flag",
              payload: { id: fe.featureKey, value: fe.result.value },
            },
          }),
        );
      });
      experimentEvalsBeingSent.forEach((ee) => {
        customEvents.push(
          serializeEvent({
            type: 5,
            timestamp: ee.timestamp,
            data: {
              tag: "experiment",
              payload: { id: ee.key, variation: ee.result.variationId },
            },
          }),
        );
      });

      const allEvents = [...eventsBeingSent, ...customEvents].sort(
        (a, b) => a.timestamp - b.timestamp,
      );

      // Same precedence as the tracking plugin's session_id column, so the
      // replay↔events join key can't diverge
      const sessionId = resolveSessionId(attrs);

      // Split into batches so each request stays under the keepalive ceiling
      // after gzip. Only isolate the snapshot when oversized AND first chunk.
      const batches = partitionEvents(
        allEvents,
        FLUSH_BYTE_SIZE,
        nextChunkIndex === 0 && totalBufferedBytes > FLUSH_BYTE_SIZE,
        (event) => event.json.length,
      );

      const commitChunk = (index: number) => {
        if (sessionReplayId !== sessionReplayIdBeingSent) return;
        chunkIndex = index + 1;
        writePersistedReplayState({
          sessionReplayId: sessionReplayIdBeingSent,
          sessionStartedAt: sessionStartedAtBeingSent,
          lastChunkIndex: index,
          lastChunkAt: Date.now(),
        });
      };

      // Committing past a lost chunk 0 would upload chunks the player can only
      // replay against an empty mirror, and persist that so a reload cements
      // it. Nothing was committed for this id, so rotating leaves no row.
      const rotateAfterLostSnapshot = (reason: string) => {
        // A rotation or restart may have moved on while this was in flight;
        // the buffers are no longer ours to clear.
        if (sessionReplayId !== sessionReplayIdBeingSent) return;
        console.error(
          `session-replay: chunk 0 ${reason}; starting a new session`,
        );
        replayEvents.length = 0;
        bufferedBytes = 0;
        featureEvals.length = 0;
        experimentEvals.length = 0;
        sessionEvents.length = 0;
        rotateSession("recovery");
      };

      for (let i = 0; i < batches.length; i++) {
        const batchChunkIndex = nextChunkIndex;
        const isFirstBatch = i === 0;

        // Events are spliced in from their stored JSON; only the small
        // envelope is serialized here
        const envelope = JSON.stringify({
          clientKey,
          session_replay_id: sessionReplayIdBeingSent,
          ...(sessionId && { gb_session_id: sessionId }),
          chunkIndex: batchChunkIndex,
          sessionStartedAt: sessionStartedAtBeingSent,
          viewport: viewportBeingSent,
          context,
          featureEvals: {
            items: isFirstBatch ? featureEvalsBeingSent : [],
          },
          experimentEvals: {
            items: isFirstBatch ? experimentEvalsBeingSent : [],
          },
          sessionEvents: {
            items: isFirstBatch ? sessionEventsRedacted : [],
          },
        });
        const payload =
          '{"events":[' +
          batches[i].map((event) => event.json).join(",") +
          "]," +
          envelope.slice(1);

        try {
          await sendWithRetry(payload);
          rejectedSnapshots = 0;
          nextChunkIndex = batchChunkIndex + 1;
          commitChunk(batchChunkIndex);
        } catch (e) {
          if (e instanceof RetryCancelledError) {
            // stopRecording cancelled a pending retry. On teardown the unsent
            // batches go back on the buffer for the final keepalive flush.
            if (sessionReplayId === sessionReplayIdBeingSent) {
              const remaining = batches.slice(i).flat();
              replayEvents.unshift(...remaining);
              bufferedBytes += remaining.reduce(
                (sum, ev) => sum + ev.json.length,
                0,
              );
              if (isFirstBatch) {
                featureEvals.unshift(...featureEvalsBeingSent);
                experimentEvals.unshift(...experimentEvalsBeingSent);
                sessionEvents.unshift(...sessionEventsBeingSent);
              }
              return;
            }
            console.warn(
              `session-replay: chunk ${batchChunkIndex} cancelled during session rotation`,
              e,
            );
            nextChunkIndex = batchChunkIndex + 1;
            continue;
          }

          if (e instanceof RetryExhaustedError) {
            if (batchChunkIndex === 0) {
              rotateAfterLostSnapshot(
                `failed after ${RETRY_MAX_ATTEMPTS} retries`,
              );
              return;
            }
            nextChunkIndex = batchChunkIndex + 1;
            commitChunk(batchChunkIndex);
            console.error(
              `session-replay: chunk ${batchChunkIndex} failed after ` +
                `${RETRY_MAX_ATTEMPTS} retries; skipping`,
              e.cause,
            );
            continue;
          }

          // Permanent 4XX — the payload or credentials are unrecoverable
          const status = errorStatus(e);
          if (status === 401 || status === 403) {
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
          if (batchChunkIndex === 0) {
            // Recovering re-snapshots, and a deterministic rejection would
            // make us pay that every flush; give up once the budget is spent
            if (rejectedSnapshots >= MAX_REJECTED_SNAPSHOTS) {
              console.error(
                `session-replay: chunk 0 rejected (HTTP ${status}) after ` +
                  `${MAX_REJECTED_SNAPSHOTS} recovery attempts; stopping the ` +
                  "recorder. Check that the ingestor accepts this payload.",
                e,
              );
              replayEvents.length = 0;
              bufferedBytes = 0;
              autoRestart = false;
              stopRecording();
              return;
            }
            rejectedSnapshots++;
            rotateAfterLostSnapshot(`permanently rejected (HTTP ${status})`);
            return;
          }
          // Other 4XX: skip and continue
          nextChunkIndex = batchChunkIndex + 1;
          commitChunk(batchChunkIndex);
          console.error(
            `session-replay: chunk ${batchChunkIndex} permanently rejected ` +
              `(HTTP ${status}); skipping`,
            e,
          );
          continue;
        }
      }
    } catch (e) {
      console.error("session-replay: flush failed", e);
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
  // sampling (programmatic getSessionReplay(gb).start()), never the kill switch.
  // interacted marks a restart triggered by an input rrweb didn't see.
  const startRecording = (
    forceNew = false,
    force = false,
    interacted = false,
  ) => {
    if (isRecording) return;
    const settings = resolveSettings();
    if (!settings.enabled) return;
    if (userOptedOutOfTracking()) return;
    resolvedPrivacy = resolvePrivacySettings({}, privacy);

    const persisted = readPersistedReplayState();
    const now = Date.now();
    const nextSessionReplayId = getOrCreateSessionReplayId(forceNew);

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

    growthbook._mergeTagAttributes({
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

    hasUserInteraction = interacted || sawPreStartInteraction;
    consumePreStartLatch();
    lastInteractionAt = Date.now();
    replayEvents = [];
    bufferedBytes = 0;
    preInteractionBytes = 0;
    pausePending = false;
    const generation = ++recordingGeneration;

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

        const serialized = serializeEvent(scrubbedEvent);
        const eventBytes = serialized.json.length;

        // Flush before the event that would overflow the cap so chunks
        // never overshoot; pre-interaction flushes would no-op anyway
        if (
          hasUserInteraction &&
          replayEvents.length > 0 &&
          bufferedBytes + eventBytes > FLUSH_BYTE_SIZE
        ) {
          void flushBuffer();
        }

        if (hasUserInteraction) {
          // Flushes are failing: drop new events rather than the snapshot
          if (replayEvents.length >= MAX_BUFFERED_EVENTS) return;
        } else {
          if (pausePending) return;
          const countsTowardCap = event.type !== 2;
          if (
            replayEvents.length >= MAX_BUFFERED_EVENTS ||
            (countsTowardCap &&
              preInteractionBytes + eventBytes > MAX_PRE_INTERACTION_BYTES)
          ) {
            pausePending = true;
            void Promise.resolve().then(() =>
              pauseUntilInteraction(generation),
            );
            return;
          }
          if (countsTowardCap) preInteractionBytes += eventBytes;
        }

        replayEvents.push(serialized);
        bufferedBytes += eventBytes;
      },
      recordCanvas: false,
      slimDOMOptions: true,
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

  // Recovery is the same visit, so it keeps the sampling decision and
  // interaction state; lifecycle rotations roll again.
  const rotateSession = (kind: "lifecycle" | "recovery") => {
    if (!isRecording) return;
    const carryState = kind === "recovery";
    const wasInteracted = carryState && hasUserInteraction;
    stopRecording();
    // cancel() only interrupts a back-off sleep, so a stop or destroy can land
    // mid-request
    if (cleanedUp || !autoRestart) return;
    startRecording(true, carryState, wasInteracted);
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

    rotateSession("lifecycle");
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

  const armInteractionListeners = (handler: () => void): (() => void) => {
    REARM_EVENTS.forEach((type) =>
      document.addEventListener(type, handler, {
        capture: true,
        passive: true,
      }),
    );
    return () =>
      REARM_EVENTS.forEach((type) =>
        document.removeEventListener(type, handler, true),
      );
  };

  // Consumed by the first recording that actually starts; a later rotation
  // must not inherit it
  const consumePreStartLatch = () => {
    sawPreStartInteraction = false;
    if (disarmPreStartLatch) {
      disarmPreStartLatch();
      disarmPreStartLatch = null;
    }
  };

  const cancelPendingStart = () => {
    if (cancelScheduledStart) {
      cancelScheduledStart();
      cancelScheduledStart = null;
    }
    if (disarmInteractionRestart) {
      disarmInteractionRestart();
      disarmInteractionRestart = null;
    }
  };

  // Starts in idle time, so the full snapshot never runs inside setPayload
  // or during page load. A restart after an interaction skips the load wait.
  const deferStart = (waitForLoad: boolean, interacted: boolean) => {
    cancelPendingStart();
    const run = () => {
      cancelScheduledStart = null;
      startRecording(false, false, interacted);
    };
    cancelScheduledStart = waitForLoad
      ? runWhenIdleAfterLoad(run)
      : runWhenIdle(run);
  };

  // Automatic starts (initial payload, remote re-enable) come through here
  const scheduleStart = () => {
    if (isRecording || cancelScheduledStart || disarmInteractionRestart) {
      return;
    }
    if (startMode === "immediate") {
      startRecording();
    } else {
      deferStart(true, false);
    }
  };

  const pauseUntilInteraction = (generation: number) => {
    if (generation !== recordingGeneration) return;
    pausePending = false;
    if (!isRecording || hasUserInteraction) return;
    // The flush inside is a no-op: nothing ships before an interaction
    stopRecording();
    replayEvents = [];
    bufferedBytes = 0;
    preInteractionBytes = 0;
    disarmInteractionRestart = armInteractionListeners(() =>
      deferStart(false, true),
    );
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

  // Exposures only; subscribe() would also capture qaMode and targeting misses
  const offExperiment = growthbook._subscribeExperimentViewed(
    (experiment, result) => {
      if (experimentEvals.length >= MAX_BUFFERED_EVENTS)
        experimentEvals.shift();
      experimentEvals.push({
        key: experiment.key,
        timestamp: Date.now(),
        name: experiment.name,
        result: {
          value: result.value,
          // Numeric index, unlike /track's "Experiment Viewed" which sends result.key
          variationId: result.variationId,
          featureId: result.featureId,
        },
      });
    },
  );

  // Buffered raw; redaction happens in flushBuffer, because this fires from
  // the moment the plugin is applied and privacy isn't resolved until the
  // recorder starts.
  const offEvent = growthbook._subscribeCustomEvents(
    (eventName, properties) => {
      if (sessionEvents.length >= MAX_BUFFERED_EVENTS) sessionEvents.shift();
      sessionEvents.push({ eventName, timestamp: Date.now(), properties });
    },
  );

  const forceStart = () => {
    autoRestart = true;
    rejectedSnapshots = 0;
    cancelPendingStart();
    startRecording(false, true);
  };
  const explicitStop = () => {
    autoRestart = false;
    cancelPendingStart();
    stopRecording();
  };
  const replayControls: SessionReplayApi = {
    start: forceStart,
    stop: explicitStop,
  };
  if (!registerSessionReplay(growthbook, replayControls)) {
    offFeature();
    offExperiment();
    offEvent();
    cleanedUp = true;
    return () => {};
  }

  // Remote settings apply mid-recording: the kill switch stops in-flight
  // recordings; re-enabling resumes unless something stopped it explicitly
  const offPayload = growthbook._subscribePayloadUpdates(() => {
    const settings = resolveSettings();
    if (!settings.enabled) {
      cancelPendingStart();
      if (isRecording) stopRecording();
    } else if (autoRestart && !isRecording) {
      scheduleStart();
    }
  });

  // Covers both pre-start windows: waiting on the payload, and the load/idle
  // deferral after it
  if (autoRecord) {
    disarmPreStartLatch = armInteractionListeners(() => {
      sawPreStartInteraction = true;
    });
  }

  // Before the payload arrives the remote settings are unknown, and the
  // sampling roll would stick; the payload subscription above starts it
  if (autoRecord && growthbook.ready) scheduleStart();

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
    cancelPendingStart();
    consumePreStartLatch();
    stopRecording();
    window.removeEventListener("pagehide", onPageHide);
    document.removeEventListener("visibilitychange", onVisibilityHide);
    unregisterSessionReplay(growthbook, replayControls);
  };

  growthbook.onDestroy(cleanup);

  return cleanup;
}
