import Cookies from "js-cookie";
import {
  CacheSettings,
  Options as Context,
  FeatureApiResponse,
  Plugin,
  TrackingCallback,
} from "./types/growthbook";
import { GrowthBook } from "./GrowthBook";
import {
  BrowserCookieStickyBucketService,
  LocalStorageStickyBucketService,
  StickyBucketService,
} from "./sticky-bucket-service";
import { autoAttributesPlugin } from "./plugins/auto-attributes";
import { growthbookTrackingPlugin } from "./plugins/growthbook-tracking";
import {
  thirdPartyTrackingPlugin,
  Trackers,
} from "./plugins/third-party-tracking";
import { browserEventsPlugin } from "./plugins/performance/browser-events";
import type { BrowserEventsSettings } from "./plugins/performance/browser-events";

type WindowContext = Context & {
  uuidCookieName?: string;
  uuidKey?: string;
  uuid?: string;
  persistUuidOnLoad?: boolean;
  noStreaming?: boolean;
  useStickyBucketService?: "cookie" | "localStorage";
  stickyBucketPrefix?: string;
  payload?: FeatureApiResponse;
  cacheSettings?: CacheSettings;
  antiFlicker?: boolean;
  antiFlickerTimeout?: number;
  additionalTrackingCallback?: TrackingCallback;
} & Partial<BrowserEventsSettings>;
declare global {
  interface Window {
    _growthbook?: GrowthBook;
    growthbook_queue?:
      | Array<(gb: GrowthBook) => void>
      | { push: (cb: (gb: GrowthBook) => void) => void };
    growthbook_config?: WindowContext;
    dataLayer?: unknown[];
    analytics?: {
      track?: (name: string, props?: Record<string, unknown>) => void;
    };
    gtag?: (...args: unknown[]) => void;
  }
}

// Ensure dataLayer exists
window.dataLayer = window.dataLayer || [];

const currentScript = document.currentScript;
const dataContext: DOMStringMap = currentScript ? currentScript.dataset : {};
const windowContext: WindowContext = window.growthbook_config || {};

let antiFlickerTimeout: number | undefined;

function setAntiFlicker() {
  window.clearTimeout(antiFlickerTimeout);

  let timeoutMs =
    windowContext.antiFlickerTimeout ??
    (dataContext.antiFlickerTimeout
      ? parseInt(dataContext.antiFlickerTimeout)
      : null) ??
    3500;
  if (!isFinite(timeoutMs)) {
    timeoutMs = 3500;
  }

  try {
    if (!document.getElementById("gb-anti-flicker-style")) {
      const styleTag = document.createElement("style");
      styleTag.setAttribute("id", "gb-anti-flicker-style");
      styleTag.innerHTML =
        ".gb-anti-flicker { opacity: 0 !important; pointer-events: none; }";
      document.head.appendChild(styleTag);
    }
    document.documentElement.classList.add("gb-anti-flicker");

    // Fallback if GrowthBook fails to load in specified time or 3.5 seconds.
    antiFlickerTimeout = window.setTimeout(unsetAntiFlicker, timeoutMs);
  } catch (e) {
    console.error(e);
  }
}

function unsetAntiFlicker() {
  window.clearTimeout(antiFlickerTimeout);
  try {
    document.documentElement.classList.remove("gb-anti-flicker");
  } catch (e) {
    console.error(e);
  }
}

if (windowContext.antiFlicker || dataContext.antiFlicker) {
  setAntiFlicker();
}

// Create sticky bucket service
let stickyBucketService: StickyBucketService | undefined = undefined;
if (
  windowContext.useStickyBucketService === "cookie" ||
  dataContext.useStickyBucketService === "cookie"
) {
  stickyBucketService = new BrowserCookieStickyBucketService({
    prefix:
      windowContext.stickyBucketPrefix ||
      dataContext.stickyBucketPrefix ||
      undefined,
    jsCookie: Cookies,
  });
} else if (
  windowContext.useStickyBucketService === "localStorage" ||
  dataContext.useStickyBucketService === "localStorage"
) {
  stickyBucketService = new LocalStorageStickyBucketService({
    prefix:
      windowContext.stickyBucketPrefix ||
      dataContext.stickyBucketPrefix ||
      undefined,
  });
}

const uuid = dataContext.uuid || windowContext.uuid;
const plugins: Plugin[] = [
  autoAttributesPlugin({
    uuid,
    uuidCookieName: windowContext.uuidCookieName || dataContext.uuidCookieName,
    uuidKey: windowContext.uuidKey || dataContext.uuidKey,
    uuidAutoPersist: !uuid && dataContext.noAutoCookies == null,
  }),
];

// Read BrowserEventsSettings from data-* attrs + windowContext, preferring data-*
const BROWSER_EVENTS_NUM_KEYS: (keyof BrowserEventsSettings)[] = [
  "cwvSamplingRate",
  "errorSamplingRate",
  "pageViewSamplingRate",
  "engagementSamplingRate",
  "interactionSamplingRate",
  "debounceErrorTimeout",
  "heartbeatIntervalMs",
  "maxHeartbeats",
  "rageThreshold",
  "rageTimeWindowMs",
  "rageMaxDistancePx",
];
const BROWSER_EVENTS_BOOL_KEYS: (keyof BrowserEventsSettings)[] = [
  "trackFCP",
  "trackLCP",
  "trackFID",
  "trackINP",
  "trackCLS",
  "trackTTFB",
  "trackTBT",
  "trackScrollDepth",
  "trackQueryStringChanges",
  "enableUrlPolling",
  "collectElementText",
  "independentSampling",
];
const BROWSER_EVENTS_STR_KEYS: (keyof BrowserEventsSettings)[] = [
  "hashAttribute",
  "samplingSeed",
  "clickSelector",
  "ignoreClickSelector",
  "sensitiveSelector",
  "formSelector",
  "ignoreFormSelector",
];

const TRUTHY_STRINGS = new Set(["1", "true", "yes", "on"]);
const FALSY_STRINGS = new Set(["0", "false", "no", "off"]);
function toBool(v: string): boolean | undefined {
  const s = v.toLowerCase().trim();
  if (TRUTHY_STRINGS.has(s)) return true;
  if (FALSY_STRINGS.has(s)) return false;
  return undefined;
}

function readBrowserEventsSettings(): BrowserEventsSettings {
  const out: Record<string, unknown> = {};
  for (const k of BROWSER_EVENTS_NUM_KEYS) {
    const v =
      dataContext[k] != null
        ? parseFloat(dataContext[k] as string)
        : windowContext[k];
    if (v != null && isFinite(v as number)) out[k] = v;
  }
  for (const k of BROWSER_EVENTS_BOOL_KEYS) {
    const v =
      dataContext[k] != null
        ? toBool(dataContext[k] as string)
        : windowContext[k];
    if (v != null) out[k] = v;
  }
  for (const k of BROWSER_EVENTS_STR_KEYS) {
    const v = dataContext[k] ?? windowContext[k];
    if (v != null) out[k] = v;
  }
  return out as BrowserEventsSettings;
}

const browserEventsSettings = readBrowserEventsSettings();
const performanceEnabled = !!(
  browserEventsSettings.cwvSamplingRate ||
  browserEventsSettings.errorSamplingRate ||
  browserEventsSettings.pageViewSamplingRate ||
  browserEventsSettings.engagementSamplingRate ||
  browserEventsSettings.interactionSamplingRate
);

const tracking = dataContext.tracking || "gtag,gtm,segment";
const trackers =
  tracking !== "none"
    ? tracking
        .toLowerCase()
        .split(",")
        .map((t) => t.trim())
    : [];

// Perf events need a logger; include even when tracking="none"
if (trackers.includes("growthbook") || performanceEnabled) {
  plugins.push(
    growthbookTrackingPlugin({
      ingestorHost: dataContext.eventIngestorHost,
    }),
  );
}

if (tracking !== "none" && !windowContext.trackingCallback) {
  plugins.push(
    thirdPartyTrackingPlugin({
      additionalCallback: windowContext.additionalTrackingCallback,
      trackers: trackers as Trackers[],
    }),
  );
}

if (performanceEnabled) {
  plugins.push(browserEventsPlugin(browserEventsSettings));
}

// Create GrowthBook instance
const gb = new GrowthBook({
  enableDevMode: true,
  ...dataContext,
  remoteEval: !!dataContext.remoteEval,
  ...windowContext,
  plugins,
  stickyBucketService,
});

// Set the renderer to fire a custom DOM event
// This will let us attach multiple listeners
gb.setRenderer(() => {
  document.dispatchEvent(new CustomEvent("growthbookdata"));
});

gb.init({
  payload: windowContext.payload,
  streaming: !(
    windowContext.noStreaming ||
    dataContext.noStreaming ||
    windowContext.backgroundSync === false
  ),
  cacheSettings: windowContext.cacheSettings,
}).then(() => {
  if (!(windowContext.antiFlicker || dataContext.antiFlicker)) return;

  if (gb.getRedirectUrl()) {
    setAntiFlicker();
  } else {
    unsetAntiFlicker();
  }
});

const fireCallback = (cb: (gb: GrowthBook) => void) => {
  try {
    cb && cb(gb);
  } catch (e) {
    console.error("Uncaught growthbook_queue error", e);
  }
};

// Process any queued callbacks
if (window.growthbook_queue) {
  if (Array.isArray(window.growthbook_queue)) {
    window.growthbook_queue.forEach((cb) => {
      fireCallback(cb);
    });
  }
}
// Replace the queue with a function that immediately calls the callback
window.growthbook_queue = {
  push: (cb: (gb: GrowthBook) => void) => {
    fireCallback(cb);
  },
};

// Store a reference in window to enable more advanced use cases
export default gb;
