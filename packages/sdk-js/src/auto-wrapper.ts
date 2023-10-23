import { Context, GrowthBook } from "./index";

declare global {
  interface Window {
    _growthbook?: GrowthBook;
    growthbook_config?: Context;
    // eslint-disable-next-line
    dataLayer: any[];
    analytics?: {
      track?: (name: string, props?: Record<string, unknown>) => void;
    };
  }
}

const getUUID = () => {
  const COOKIE_NAME = "gbuuid";
  const COOKIE_DAYS = 400; // 400 days is the max cookie duration for chrome

  // use the browsers crypto.randomUUID if set
  const genUUID = () => {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return ("" + 1e7 + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (c) =>
      (
        ((c as unknown) as number) ^
        (crypto.getRandomValues(new Uint8Array(1))[0] &
          (15 >> (((c as unknown) as number) / 4)))
      ).toString(16)
    );
  };
  const getCookie = (name: string): string => {
    const value = "; " + document.cookie;
    const parts = value.split(`; ${name}=`);
    return parts.length === 2 ? parts[1].split(";")[0] : "";
  };
  const setCookie = (name: string, value: string) => {
    const d = new Date();
    d.setTime(d.getTime() + 24 * 60 * 60 * 1000 * COOKIE_DAYS);
    document.cookie = name + "=" + value + ";path=/;expires=" + d.toUTCString();
  };

  // get the existing UUID from cookie if set, otherwise create one and store it in the cookie
  if (getCookie(COOKIE_NAME)) return getCookie(COOKIE_NAME);

  const uuid = genUUID();
  setCookie(COOKIE_NAME, uuid);
  return uuid;
};

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

function getAutoAttributes() {
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

  return {
    id: getUUID(),
    url: location.href,
    path: location.pathname,
    host: location.host,
    query: location.search,
    deviceType: ua.match(/Mobi/) ? "mobile" : "desktop",
    browser,
    ...getUtmAttributes(),
  };
}

// Initialize the data layer if it doesn't exist yet (GA4, GTM)
window.dataLayer = window.dataLayer || [];

const currentScript = document.currentScript;
const dataContext = currentScript ? currentScript.dataset : {};
const windowContext = window.growthbook_config || {};

function getAttributes() {
  // Merge auto attributes and user-supplied attributes
  const attributes = dataContext["noAutoAttributes"] ? {} : getAutoAttributes();
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
    window.dataLayer.push(["event", "experiment_viewed", p]);
    window.analytics &&
      window.analytics.track &&
      window.analytics.track("Experiment Viewed", p);
  },
  ...windowContext,
  attributes: getAttributes(),
});

// Load features/experiments
gb.loadFeatures();

// Poll for URL changes and update GrowthBook
let currentUrl = location.href;
setInterval(() => {
  if (location.href !== currentUrl) {
    currentUrl = location.href;
    gb.setURL(currentUrl);
    gb.setAttributes({
      ...gb.getAttributes(),
      ...getAttributes(),
    });
  }
}, 500);

// Store a reference in window to enable more advanced use cases
export default gb;
