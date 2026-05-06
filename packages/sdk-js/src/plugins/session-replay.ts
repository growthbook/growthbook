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
    _gbGetReplayEvents: () => eventWithTime[];
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
  let flushInterval: ReturnType<typeof setInterval> | null = null;
  let idleCheckInterval: ReturnType<typeof setInterval> | null = null;

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
        acc[key] = result.value.variationId;
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
      attributes: gbRef.getAttributes(),
      experiments: evaluatedExperiments,
      flags,
    };

    const events = window._gbGetReplayEvents();

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

    // Use a regular fetch — payload is too large for sendBeacon/keepalive limits.
    fetch(`${host}/ingest/session-replay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
    }).catch(() => {
      // best-effort
    });

    chunkIndex++;
    window._gbReplayEvents.length = 0;
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
    window._gbReplayEvents = [];

    const rrwebStop = record({
      emit(event: eventWithTime) {
        // Scrub URL fields BEFORE the event lands in the buffer so any
        // downstream observer (the buffer itself, the flush payload, an
        // attacker who somehow reads window._gbReplayEvents) only ever
        // sees a sanitized version. Meta events are the only URL-bearing
        // events rrweb emits today; see scrubEventUrls for the contract.
        const scrubbedEvent = scrubEventUrls(event, privacy?.url);

        if (window._gbReplayEvents.length < 200) {
          window._gbReplayEvents.push(scrubbedEvent);
        }
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
        if (event.type === 3) {
          const source = (event.data as { source?: number })?.source;
          if (source === 2 || source === 5 || source === 6 || source === 12) {
            hasUserInteraction = true;
            lastInteractionAt = Date.now();
          }
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

    flushInterval = setInterval(flushBuffer, 30_000);
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
    window._gbGetReplayEvents = () => {
      const customEvents: eventWithTime[] = [];
      gb.logs?.forEach?.((log) => {
        if (log.logType === "feature") {
          customEvents.push({
            type: 5,
            timestamp: parseInt(log.timestamp),
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
            timestamp: parseInt(log.timestamp),
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
