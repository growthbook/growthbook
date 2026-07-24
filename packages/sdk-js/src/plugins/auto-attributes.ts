import type { GrowthBook } from "../GrowthBook";
import type {
  UserScopedGrowthBook,
  GrowthBookClient,
} from "../GrowthBookClient";
import {
  genUUID,
  getOrCreateSessionReplayId,
  touchSessionReplayId,
} from "./session-replay-id";

export type AutoAttributeSettings = {
  uuidCookieName?: string;
  uuidKey?: string;
  uuid?: string;
  uuidAutoPersist?: boolean;
};

const SESSION_REPLAY_TOUCH_THROTTLE_MS = 60 * 1000;
const SESSION_REPLAY_ACTIVITY_EVENTS = [
  "pointerdown",
  "keydown",
  "scroll",
  "touchstart",
] as const;

function getBrowserDevice(ua: string): { browser: string; deviceType: string } {
  const browser = ua.match(/Edg/)
    ? "edge"
    : ua.match(/Chrome/)
      ? "chrome"
      : ua.match(/Firefox/)
        ? "firefox"
        : ua.match(/Safari/)
          ? "safari"
          : "unknown";

  const deviceType = ua.match(/Mobi/) ? "mobile" : "desktop";

  return { browser, deviceType };
}

function getURLAttributes(url: URL | Location | undefined) {
  if (!url) return {};
  return {
    url: url.href,
    path: url.pathname,
    host: url.host,
    query: url.search,
  };
}

export function autoAttributesPlugin(settings: AutoAttributeSettings = {}) {
  // Browser only
  if (typeof window === "undefined") {
    throw new Error("autoAttributesPlugin only works in the browser");
  }

  const COOKIE_NAME = settings.uuidCookieName || "gbuuid";
  const uuidKey = settings.uuidKey || "id";
  let uuid = settings.uuid || "";
  function persistUUID() {
    setCookie(COOKIE_NAME, uuid);
  }
  function getUUID() {
    // Already stored in memory, return
    if (uuid) return uuid;

    // If cookie is already set, return
    uuid = getCookie(COOKIE_NAME);
    if (uuid) return uuid;

    // Generate a new UUID
    uuid = genUUID(window.crypto);
    return uuid;
  }

  // Listen for a custom event to persist the UUID cookie
  document.addEventListener("growthbookpersist", () => {
    persistUUID();
  });

  function getAutoAttributes(settings: AutoAttributeSettings) {
    const ua = navigator.userAgent;

    const _uuid = getUUID();

    // If a uuid is provided, default persist to false, otherwise default to true
    if (settings.uuidAutoPersist ?? !settings.uuid) {
      persistUUID();
    }

    const url = location;

    return {
      ...getDataLayerVariables(),
      [uuidKey]: _uuid,
      session_replay_id: getOrCreateSessionReplayId(),
      ...getURLAttributes(url),
      pageTitle: document.title,
      viewportWidth: window.innerWidth || 0,
      viewportHeight: window.innerHeight || 0,
      ...getBrowserDevice(ua),
      ...getUtmAttributes(url),
    };
  }

  return (gb: GrowthBook | UserScopedGrowthBook | GrowthBookClient) => {
    // Only works for instances with user attributes
    if ("createScopedInstance" in gb) {
      return;
    }

    // Set initial attributes
    const attributes = getAutoAttributes(settings);
    attributes.url && gb.setURL(attributes.url);
    gb.updateAttributes(attributes);

    let lastSessionReplayTouchAt = Date.now();
    const sessionReplayActivityListener = () => {
      const now = Date.now();
      if (now - lastSessionReplayTouchAt < SESSION_REPLAY_TOUCH_THROTTLE_MS) {
        return;
      }
      lastSessionReplayTouchAt = now;
      touchSessionReplayId();
    };
    SESSION_REPLAY_ACTIVITY_EVENTS.forEach((eventName) => {
      window.addEventListener(eventName, sessionReplayActivityListener, {
        passive: true,
      });
    });

    // Poll for URL changes and update GrowthBook
    let currentUrl = attributes.url;
    const intervalTimer = setInterval(() => {
      if (location.href !== currentUrl) {
        currentUrl = location.href;
        gb.setURL(currentUrl);
        gb.updateAttributes(getAutoAttributes(settings));
      }
    }, 500);

    // Listen for a custom event to update URL and attributes
    const refreshListener = () => {
      if (location.href !== currentUrl) {
        currentUrl = location.href;
        gb.setURL(currentUrl);
      }
      gb.updateAttributes(getAutoAttributes(settings));
    };
    document.addEventListener("growthbookrefresh", refreshListener);

    if ("onDestroy" in gb) {
      gb.onDestroy(() => {
        clearInterval(intervalTimer);
        document.removeEventListener("growthbookrefresh", refreshListener);
        SESSION_REPLAY_ACTIVITY_EVENTS.forEach((eventName) => {
          window.removeEventListener(eventName, sessionReplayActivityListener);
        });
      });
    }
  };
}

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

function getUtmAttributes(url: URL | Location | undefined) {
  // Store utm- params in sessionStorage for future page loads
  let utms: Record<string, string> = {};
  try {
    const existing = sessionStorage.getItem("utm_params");
    if (existing) {
      utms = JSON.parse(existing);
    }
  } catch (e) {
    // Do nothing if sessionStorage is disabled (e.g. incognito window)
  }

  // Add utm params from querystring
  if (url && url.search) {
    const params = new URLSearchParams(url.search);
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
      try {
        sessionStorage.setItem("utm_params", JSON.stringify(utms));
      } catch (e) {
        // Do nothing if sessionStorage is disabled (e.g. incognito window)
      }
    }
  }

  return utms;
}

function getDataLayerVariables() {
  if (
    typeof window === "undefined" ||
    !window.dataLayer ||
    !window.dataLayer.forEach
  ) {
    return {};
  }

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
