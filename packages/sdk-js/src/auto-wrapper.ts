import Cookies from "js-cookie";
import {
  CacheSettings,
  Options as Context,
  FeatureApiResponse,
  TrackingCallback,
} from "./types/growthbook";
import { GrowthBook } from "./GrowthBook";
import {
  BrowserCookieStickyBucketService,
  LocalStorageStickyBucketService,
  StickyBucketService,
} from "./sticky-bucket-service";

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
};
declare global {
  interface Window {
    _growthbook?: GrowthBook;
    growthbook_queue?:
      | Array<(gb: GrowthBook) => void>
      | { push: (cb: (gb: GrowthBook) => void) => void };
    growthbook_config?: WindowContext;
    // eslint-disable-next-line
    dataLayer?: any[];
    analytics?: {
      track?: (name: string, props?: Record<string, unknown>) => void;
    };
    // eslint-disable-next-line
    gtag?: (...args: any) => void;
  }
}

// Ensure dataLayer exists
window.dataLayer = window.dataLayer || [];

const currentScript = document.currentScript;
const dataContext: DOMStringMap = currentScript ? currentScript.dataset : {};
const windowContext: WindowContext = window.growthbook_config || {};

function setCookie(name: string, value: string) {
  const d = new Date();
  const COOKIE_DAYS = 400; // 400 days is the max cookie duration for chrome
  d.setTime(d.getTime() + 24 * 60 * 60 * 1000 * COOKIE_DAYS);
  document.cookie = name + "=" + value + ";path=/;expires=" + d.toUTCString();
}

function getCookie(name: string): string {
  const value = "; " + document.cookie;
  const parts = value.split(`; ${name}=`);
  return parts.length === 2 ? parts[1].split(";")[0] : "";
}

// Use the browsers crypto.randomUUID if set to generate a UUID
function genUUID() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return ("" + 1e7 + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (c) =>
    (
      ((c as unknown) as number) ^
      (crypto.getRandomValues(new Uint8Array(1))[0] &
        (15 >> (((c as unknown) as number) / 4)))
    ).toString(16)
  );
}

const COOKIE_NAME =
  windowContext.uuidCookieName || dataContext.uuidCookieName || "gbuuid";
const uuidKey = windowContext.uuidKey || dataContext.uuidKey || "id";
let uuid = windowContext.uuid || dataContext.uuid || "";
function persistUUID() {
  setCookie(COOKIE_NAME, uuid);
}
function getUUID(persist = true) {
  // Already stored in memory, return
  if (uuid) return uuid;

  // If cookie is already set, return
  uuid = getCookie(COOKIE_NAME);
  if (uuid) return uuid;

  // Generate a new UUID and optionally persist it in a cookie
  uuid = genUUID();
  if (persist) {
    persistUUID();
  }

  return uuid;
}

function getUtmAttributes() {
  // Store utm- params in sessionStorage for future page loads
  let utms: Record<string, string> = {};
  try {
    const existing = sessionStorage.getItem("utm_params");
    if (existing) {
      utms = JSON.parse(existing);
    }

    // Add utm params from querystring
    if (location.search) {
      const params = new URLSearchParams(location.search);
      let hasChanges = false;
      ["source", "medium", "campaign", "term", "content"].forEach((k) => {
        // Querystring is in snake_case
        const param = `utm_${k}`;
        // Attribute keys are camelCase
        const attr = `utm` + k[0].toUpperCase() + k.slice(1);

        if (params.has(param)) {
          utms[attr] = params.get(param) || "";
          hasChanges = true;
        }
      });

      // Write back to sessionStorage
      if (hasChanges) {
        sessionStorage.setItem("utm_params", JSON.stringify(utms));
      }
    }
  } catch (e) {
    // Do nothing if sessionStorage is disabled (e.g. incognito window)
  }

  return utms;
}

function getDataLayerVariables() {
  if (!window.dataLayer || !window.dataLayer.forEach) return {};
  const obj: Record<string, unknown> = {};
  window.dataLayer.forEach((item: unknown) => {
    // Skip empty and non-object entries
    if (!item || typeof item !== "object" || "length" in item) return;

    // Skip events
    if ("event" in item) return;

    Object.keys(item).forEach((k) => {
      // Filter out known properties that aren't useful
      if (typeof k !== "string" || k.match(/^(gtm)/)) return;

      const val = (item as Record<string, unknown>)[k];

      // Only add primitive variable values
      const valueType = typeof val;
      if (["string", "number", "boolean"].includes(valueType)) {
        obj[k] = val;
      }
    });
  });
  return obj;
}

function getAutoAttributes(
  dataContext: DOMStringMap,
  windowContext: WindowContext
) {
  const useCookies = dataContext.noAutoCookies == null;

  const ua = navigator.userAgent;

  const browser = ua.match(/Edg/)
    ? "edge"
    : ua.match(/Chrome/)
    ? "chrome"
    : ua.match(/Firefox/)
    ? "firefox"
    : ua.match(/Safari/)
    ? "safari"
    : "unknown";

  const _uuid = getUUID(useCookies);
  if (
    (windowContext.persistUuidOnLoad || dataContext.persistUuidOnLoad) &&
    useCookies
  ) {
    persistUUID();
  }

  return {
    ...getDataLayerVariables(),
    [uuidKey]: _uuid,
    url: location.href,
    path: location.pathname,
    host: location.host,
    query: location.search,
    pageTitle: document && document.title,
    deviceType: ua.match(/Mobi/) ? "mobile" : "desktop",
    browser,
    ...getUtmAttributes(),
  };
}

function getAttributes() {
  // Merge auto attributes and user-supplied attributes
  const attributes = dataContext["noAutoAttributes"]
    ? {}
    : getAutoAttributes(dataContext, windowContext);
  if (windowContext.attributes) {
    Object.assign(attributes, windowContext.attributes);
  }
  return attributes;
}

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

// Create GrowthBook instance
const gb = new GrowthBook({
  ...dataContext,
  remoteEval: !!dataContext.remoteEval,
  trackingCallback: async (e, r) => {
    const promises: Promise<unknown>[] = [];
    const eventParams = { experiment_id: e.key, variation_id: r.key };

    if (windowContext.additionalTrackingCallback) {
      promises.push(
        Promise.resolve(windowContext.additionalTrackingCallback(e, r))
      );
    }

    // GA4 - gtag
    if (window.gtag) {
      let gtagResolve;
      const gtagPromise = new Promise((resolve) => {
        gtagResolve = resolve;
      });
      promises.push(gtagPromise);
      window.gtag("event", "experiment_viewed", {
        ...eventParams,
        event_callback: gtagResolve,
      });
    }

    // GTM - dataLayer
    if (window.dataLayer) {
      let datalayerResolve;
      const datalayerPromise = new Promise((resolve) => {
        datalayerResolve = resolve;
      });
      promises.push(datalayerPromise);
      window.dataLayer.push({
        event: "experiment_viewed",
        ...eventParams,
        eventCallback: datalayerResolve,
      });
    }

    // Segment - analytics.js
    if (window.analytics && window.analytics.track) {
      window.analytics.track("Experiment Viewed", eventParams);
      const segmentPromise = new Promise((resolve) =>
        window.setTimeout(resolve, 300)
      );
      promises.push(segmentPromise);
    }

    await Promise.all(promises);
  },
  ...windowContext,
  attributes: getAttributes(),
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

// Poll for URL changes and update GrowthBook
let currentUrl = location.href;
setInterval(() => {
  if (location.href !== currentUrl) {
    currentUrl = location.href;
    gb.setURL(currentUrl);
    gb.updateAttributes(getAttributes());
  }
}, 500);

// Listen for a custom event to update URL and attributes
document.addEventListener("growthbookrefresh", () => {
  if (location.href !== currentUrl) {
    currentUrl = location.href;
    gb.setURL(currentUrl);
  }
  gb.updateAttributes(getAttributes());
});

// Listen for a custom event to persist the UUID cookie
document.addEventListener("growthbookpersist", () => {
  persistUUID();
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
