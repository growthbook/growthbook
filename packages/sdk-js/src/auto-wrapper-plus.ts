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
import {
  sessionReplayPlugin,
  SessionReplayPrivacyConfig,
} from "./plugins/session-replay";

// -----------------------------------------------------------------------------
// auto-wrapper-plus
// -----------------------------------------------------------------------------
// Drop-in script-tag bundle that mirrors auto-wrapper.ts AND wires up
// additional plugins (currently: session-replay; future additions land here).
// Customers who don't want the extras continue to use the slimmer
// auto.min.js.
//
// rrweb is inlined into this bundle (Rollup `external: () => false`) so this
// is a fully self-contained file — no extra script tag, no separate rrweb
// dependency.
// -----------------------------------------------------------------------------

type SessionReplayConfig = {
  /**
   * Per-app kill switch. Default true.
   */
  enabled?: boolean;

  /**
   * rrweb privacy controls. See SessionReplayPrivacyConfig for the full
   * surface — mask/block/ignore selectors, custom mask functions, URL
   * scrubber config, etc. Not expressible via data-attributes; must be
   * set via window.growthbook_config.sessionReplay.privacy.
   */
  privacy?: SessionReplayPrivacyConfig;
};

const CLOUD_INGESTOR_HOST = "__INGESTOR_HOST__";

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
  sessionReplay?: SessionReplayConfig;
  trackingHost?: string;
};

// Ensure dataLayer exists
window.dataLayer = window.dataLayer || [];

const currentScript = document.currentScript;
const dataContext: DOMStringMap = currentScript ? currentScript.dataset : {};
// Cast through the auto-wrapper.ts-declared shape (without sessionReplay) to
// our local shape (with sessionReplay).
const windowContext: WindowContext =
  (window.growthbook_config as WindowContext | undefined) || {};

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

const tracking = dataContext.tracking || "gtag,gtm,segment";
if (tracking !== "none") {
  const trackers = tracking
    .toLowerCase()
    .split(",")
    .map((t) => t.trim());

  if (trackers.includes("growthbook")) {
    plugins.push(
      growthbookTrackingPlugin({
        ingestorHost: dataContext.eventIngestorHost,
      }),
    );
  }

  if (!windowContext.trackingCallback) {
    plugins.push(
      thirdPartyTrackingPlugin({
        additionalCallback: windowContext.additionalTrackingCallback,
        trackers: trackers as Trackers[],
      }),
    );
  }
}

// -----------------------------------------------------------------------------
// Session-replay wiring
// -----------------------------------------------------------------------------
// Enabled by default
// -----------------------------------------------------------------------------

const sessionReplayDisabled =
  windowContext.sessionReplay?.enabled === false ||
  dataContext.sessionReplayDisabled === "" ||
  dataContext.sessionReplayDisabled === "true";

if (!sessionReplayDisabled) {
  plugins.push(
    sessionReplayPlugin({
      trackingHost:
        dataContext.eventIngestorHost ||
        windowContext.trackingHost ||
        CLOUD_INGESTOR_HOST,
      enabled: windowContext.sessionReplay?.enabled,
      privacy: windowContext.sessionReplay?.privacy,
    }) as Plugin,
  );
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
