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
import {
  AUTO_EVENT_CATEGORIES,
  autoEventsPlugin,
  type AutoEventsSettings,
} from "./plugins/auto-events/index";
import { persistRedirectExposures } from "./redirect-exposure";
import type { PrivacySettings } from "./plugins/utils/privacy";

// Entrypoints extend this with their own plugin settings
export type WindowContext = Context & {
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
  autoEvents?: AutoEventsSettings;
  eventIngestorHost?: string;
  // Shared by every content-capturing plugin unless it sets its own
  privacy?: PrivacySettings;
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

export type WrapperDefaults = {
  autoEvents?: AutoEventsSettings;
};

// Shared by both script-tag bundles; each entrypoint calls it once with its
// own defaults
export function buildCore(defaults: WrapperDefaults = {}) {
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
      uuidCookieName:
        windowContext.uuidCookieName || dataContext.uuidCookieName,
      uuidCookieDomain,
      uuidKey: windowContext.uuidKey || dataContext.uuidKey,
      uuidAutoPersist: !uuid && (dataContext.noAutoCookies ?? null) === null,
    }),
  ];

  // Script-tag surface for auto-events, mirroring data-tracking:
  //   data-auto-events="pageEvents,errors,cwv,clickstream" (or "all")
  // Everything else (sampling rates, privacy, per-category options) goes
  // through window.growthbook_config.autoEvents, which mirrors the plugin's
  // own settings type and wins outright when present. Unlisted categories
  // stay undefined so remote sdkSettings can still turn them on.
  function readAutoEventsSettings(): AutoEventsSettings {
    if (windowContext.autoEvents) return windowContext.autoEvents;
    const settings: AutoEventsSettings = {};
    const list = dataContext.autoEvents;
    if (list === undefined) return settings;
    const listed = new Set(
      list === "all"
        ? AUTO_EVENT_CATEGORIES
        : list.split(",").map((s) => s.trim()),
    );
    for (const category of AUTO_EVENT_CATEGORIES) {
      if (listed.has(category)) settings[category] = true;
    }
    return settings;
  }

  const autoEventsSettings: AutoEventsSettings = {
    privacy: windowContext.privacy,
    ...defaults.autoEvents,
    ...readAutoEventsSettings(),
  };

  const tracking = dataContext.tracking || "gtag,gtm,segment";
  const trackers =
    tracking !== "none"
      ? tracking
          .toLowerCase()
          .split(",")
          .map((t) => t.trim())
      : [];

  // Always installed: remote sdkSettings can turn auto-events on at any time,
  // so the logger must exist. Without the "growthbook" tracker only custom
  // events ship, not exposures and feature evaluations.
  const growthbookTracking = trackers.includes("growthbook");
  {
    const eventTransport =
      windowContext.eventTransport || dataContext.eventTransport;
    plugins.push(
      growthbookTrackingPlugin({
        ingestorHost:
          windowContext.eventIngestorHost || dataContext.eventIngestorHost,
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

  plugins.push(autoEventsPlugin(autoEventsSettings));

  // Create GrowthBook instance
  const gb = new GrowthBook({
    enableDevMode: true,
    ...dataContext,
    remoteEval: !!dataContext.remoteEval,
    ...windowContext,
    plugins,
    stickyBucketService,
  });
  persistRedirectExposures(gb);

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

  return { gb, dataContext, windowContext };
}
