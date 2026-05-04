import { record } from "rrweb";
import type { eventWithTime } from "@rrweb/types";
import { GrowthBook } from "../GrowthBook";
import {
  SessionReplayPrivacyConfig,
  buildRrwebPrivacyOptions,
} from "./session-replay-privacy";

export type {
  SessionReplayPrivacyConfig,
  MaskableInputType,
} from "./session-replay-privacy";
export {
  GB_BLOCK_CLASS,
  GB_MASK_CLASS,
  GB_IGNORE_CLASS,
} from "./session-replay-privacy";

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
  let flushInterval: ReturnType<typeof setInterval> | null = null;

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

    const payload = JSON.stringify({
      clientKey,
      sessionId,
      chunkIndex,
      events,
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
    window._gbReplayEvents = [];

    const rrwebStop = record({
      emit(event: eventWithTime) {
        if (window._gbReplayEvents.length < 200) {
          window._gbReplayEvents.push(event);
        }
        // type 3 = IncrementalSnapshot; source 0 = DOM Mutation (not a user action)
        if (
          event.type === 3 &&
          (event.data as { source?: number })?.source !== 0
        ) {
          hasUserInteraction = true;
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
  };

  const plugin = (gb: GrowthBook) => {
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

    if (autoRecord) startRecording();

    window.addEventListener("pagehide", flushBuffer);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flushBuffer();
    });

    "onDestroy" in gb &&
      gb.onDestroy(() => {
        stopRecording();
      });
  };

  return { plugin, startRecording, stopRecording };
}
