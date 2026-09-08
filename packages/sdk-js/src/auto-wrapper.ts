import Cookies from "js-cookie";
import {
  CacheSettings,
  Options as Context,
  FeatureApiResponse,
  Plugin,
  TrackingCallback,
} from "./types/growthbook";
import { GrowthBook } from "./GrowthBook";
import { EVENT_EXPERIMENT_VIEWED } from "./core";
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
import { autoEventsPlugin } from "./plugins/auto-events";
import type { AutoEventsSettings } from "./plugins/auto-events";
import type { SessionReplayPrivacyConfig } from "./plugins/session-replay";

type WindowContext = Context & {
  uuidCookieName?: string;
  uuidCookieDomain?: string;
  eventTransport?: string;
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
  browserEvents?: AutoEventsSettings;
  // Consumed by auto-wrapper-plus
  trackingHost?: string;
  sessionReplay?: { enabled?: boolean; privacy?: SessionReplayPrivacyConfig };
};
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

const uuidCookieDomain =
  windowContext.uuidCookieDomain || dataContext.uuidCookieDomain;

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
    // Sticky assignments must follow the shared identity across subdomains
    ...(uuidCookieDomain
      ? { cookieAttributes: { expires: 180, domain: uuidCookieDomain } }
      : {}),
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
    uuidCookieDomain,
    uuidKey: windowContext.uuidKey || dataContext.uuidKey,
    uuidAutoPersist: !uuid && (dataContext.noAutoCookies ?? null) === null,
  }),
];

// Script-tag surface for auto-events: per-stream opt-in booleans plus optional
// sampling rates (dataset key → setting). Everything else is configured via
// window.growthbook_config.browserEvents.
const BROWSER_EVENTS_BOOL_ATTRS: Record<string, keyof AutoEventsSettings> = {
  trackCwv: "trackCWV",
  trackErrors: "trackErrors",
  trackPageViews: "trackPageViews",
  trackEngagement: "trackEngagement",
  trackInteractions: "trackInteractions",
};
const BROWSER_EVENTS_RATE_ATTRS: (keyof AutoEventsSettings)[] = [
  "cwvSamplingRate",
  "errorSamplingRate",
  "pageViewSamplingRate",
  "engagementSamplingRate",
  "interactionSamplingRate",
];

function readAutoEventsSettings(): AutoEventsSettings {
  const out: Record<string, unknown> = { ...windowContext.browserEvents };
  for (const [attr, key] of Object.entries(BROWSER_EVENTS_BOOL_ATTRS)) {
    const raw = dataContext[attr];
    if (raw !== undefined) out[key] = raw === "true";
  }
  for (const key of BROWSER_EVENTS_RATE_ATTRS) {
    const raw = dataContext[key];
    if (raw !== undefined) out[key] = parseFloat(raw);
  }
  return out as AutoEventsSettings;
}

const browserEventsSettings = readAutoEventsSettings();
// Streams are opt-in; sampling rates never decide whether a stream exists
// (a payload-delivered rate may later override the local one)
const autoEventsEnabled = Object.values(BROWSER_EVENTS_BOOL_ATTRS).some(
  (key) => browserEventsSettings[key] === true,
);

const tracking = dataContext.tracking || "gtag,gtm,segment";
const trackers =
  tracking !== "none"
    ? tracking
        .toLowerCase()
        .split(",")
        .map((t) => t.trim())
    : [];

// Perf events need a logger even when "growthbook" isn't a configured
// tracker — but then only perf/custom events ship, not every exposure and
// feature evaluation the user never opted into sending
const growthbookTracking = trackers.includes("growthbook");
if (growthbookTracking || autoEventsEnabled) {
  const eventTransport =
    windowContext.eventTransport || dataContext.eventTransport;
  plugins.push(
    growthbookTrackingPlugin({
      ingestorHost: dataContext.eventIngestorHost,
      transport:
        eventTransport === "auto" ||
        eventTransport === "beacon" ||
        eventTransport === "fetch"
          ? eventTransport
          : undefined,
      enableFeatureUsageEvents: growthbookTracking,
      eventFilter: growthbookTracking
        ? undefined
        : (e) => e.eventName !== EVENT_EXPERIMENT_VIEWED,
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

if (autoEventsEnabled) {
  plugins.push(autoEventsPlugin(browserEventsSettings));
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
export { dataContext, windowContext };
