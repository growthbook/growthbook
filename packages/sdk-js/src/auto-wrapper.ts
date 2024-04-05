import { Context, GrowthBook } from "./index";

type WindowContext = Context & {
  uuidCookieName?: string;
  uuidKey?: string;
  uuid?: string;
  attributeKeys?: Record<string, string>;
  persistUuidOnLoad?: boolean;
  loadStoredPayload?: boolean;
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
  const attributeKeys = windowContext.attributeKeys || {};

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
  if (windowContext.persistUuidOnLoad && useCookies) {
    persistUUID();
  }

  return {
    ...getDataLayerVariables(),
    [uuidKey]: _uuid,
    [attributeKeys.url || "url"]: location.href,
    [attributeKeys.path || "path"]: location.pathname,
    [attributeKeys.host || "host"]: location.host,
    [attributeKeys.query || "query"]: location.search,
    [attributeKeys.pageTitle || "pageTitle"]: document && document.title,
    [attributeKeys.deviceType || "deviceType"]: ua.match(/Mobi/)
      ? "mobile"
      : "desktop",
    [attributeKeys.browser || "browser"]: browser,
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

// Create GrowthBook instance
const gb = new GrowthBook({
  ...dataContext,
  remoteEval: !!dataContext.remoteEval,
  subscribeToChanges: true,
  trackingCallback: (e, r) => {
    const p = { experiment_id: e.key, variation_id: r.key };

    // GA4 (gtag and GTM options)
    window.gtag
      ? window.gtag("event", "experiment_viewed", p)
      : window.dataLayer &&
        window.dataLayer.push({ event: "experiment_viewed", ...p });

    // Segment
    window.analytics &&
      window.analytics.track &&
      window.analytics.track("Experiment Viewed", p);
  },
  ...windowContext,
  attributes: getAttributes(),
});

// Set the renderer to fire a custom DOM event
// This will let us attach multiple listeners
gb.setRenderer(() => {
  document.dispatchEvent(new CustomEvent("growthbookdata"));
});

// Load features/experiments
gb.loadFeatures();

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
