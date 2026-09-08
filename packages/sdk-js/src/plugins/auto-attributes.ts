/**
 * Populates a GrowthBook instance with common targeting attributes
 * automatically. Covers identity (a cookie-persisted anonymous id and the
 * shared session id), page context (url/path/host/query, title, viewport),
 * device (browser, device type), UTM params, and GTM dataLayer variables.
 *
 * Attributes refresh on URL changes (polled) and on a `growthbookrefresh`
 * DOM event; `growthbookpersist` forces the anonymous-id cookie write (for
 * deferred-consent flows). Also the config point for the shared gb session's
 * expiry policy (`idleTimeout` / `maxDuration`). Browser only.
 */
import type { GrowthBook } from "../GrowthBook";
import type {
  UserScopedGrowthBook,
  GrowthBookClient,
} from "../GrowthBookClient";
import { genUUID } from "../util";
import { configureGbSession, getOrCreateGbSessionId } from "./utils/gb-session";
import { readSessionJSON, writeSessionJSON } from "./utils/storage";
import { subscribeToUrlChanges } from "./utils/urlChangeObserver";

export type AutoAttributeSettings = {
  uuidCookieName?: string;
  uuidKey?: string;
  uuid?: string;
  uuidAutoPersist?: boolean;
  // Scope the uuid cookie to a parent domain (e.g. ".example.com") so the same
  // anonymous id is shared across subdomains. Without this the cookie is
  // host-only and a redirect to another subdomain mints a brand new id.
  uuidCookieDomain?: string;
  // Inactivity window (ms) on the shared gb session; each read refreshes it.
  // Defaults to 10 minutes.
  idleTimeout?: number;
  // Hard time cap (ms) on the shared gb session, regardless of activity.
  // Defaults to 1 hour.
  maxDuration?: number;
};

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

  // Module-level, so every consumer touches the session with the same windows
  configureGbSession({
    idleTimeout: settings.idleTimeout,
    maxDuration: settings.maxDuration,
  });

  const COOKIE_NAME = settings.uuidCookieName || "gbuuid";
  const COOKIE_DOMAIN = settings.uuidCookieDomain || "";
  const uuidKey = settings.uuidKey || "id";
  let uuid = settings.uuid || "";
  function persistUUID() {
    if (!COOKIE_DOMAIN) {
      setCookie(COOKIE_NAME, uuid);
      return;
    }
    // Remove any legacy host-only cookie first - two same-named cookies would
    // shadow each other and make reads unreliable
    expireCookie(COOKIE_NAME);
    setCookie(COOKIE_NAME, uuid, COOKIE_DOMAIN);
    // Browsers silently reject a cookie whose domain doesn't cover this host
    // (e.g. a typo) - fall back to host-only so the id stays stable here
    if (getCookie(COOKIE_NAME) !== uuid) {
      setCookie(COOKIE_NAME, uuid);
    }
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
      sessionId: getOrCreateGbSessionId(),
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

    // Refresh on SPA navigation — synchronously via the history hooks so
    // plugins registered after this one see fresh attributes, with a poll as
    // the fallback for routers that bypass them
    let currentUrl = attributes.url;
    const refreshIfUrlChanged = () => {
      if (location.href === currentUrl) return;
      currentUrl = location.href;
      gb.setURL(currentUrl);
      gb.updateAttributes(getAutoAttributes(settings));
    };
    const unsubUrlChanges = subscribeToUrlChanges(refreshIfUrlChanged, {
      trackQueryString: true,
    });
    const intervalTimer = setInterval(refreshIfUrlChanged, 500);

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
        unsubUrlChanges();
        document.removeEventListener("growthbookrefresh", refreshListener);
      });
    }
  };
}

function setCookie(name: string, value: string, domain?: string) {
  const d = new Date();
  const COOKIE_DAYS = 400; // 400 days is the max cookie duration for chrome
  d.setTime(d.getTime() + 24 * 60 * 60 * 1000 * COOKIE_DAYS);
  const domainStr = domain ? ";domain=" + domain : "";
  document.cookie =
    name + "=" + value + ";path=/" + domainStr + ";expires=" + d.toUTCString();
}

function expireCookie(name: string) {
  // No domain attribute, so this only removes the host-only cookie
  document.cookie = name + "=;path=/;expires=Thu, 01 Jan 1970 00:00:00 GMT";
}

function getCookie(name: string): string {
  // A host-only and a domain-scoped cookie can coexist under the same name
  // (e.g. before/after uuidCookieDomain is enabled) - use the first match
  const value = "; " + document.cookie;
  const parts = value.split(`; ${name}=`);
  return parts.length >= 2 ? parts[1].split(";")[0] : "";
}

function getUtmAttributes(url: URL | Location | undefined) {
  // Store utm- params in sessionStorage for future page loads
  let utms: Record<string, string> = {};
  const existing = readSessionJSON("utm_params");
  if (existing && typeof existing === "object") {
    utms = existing as Record<string, string>;
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

    // Write back to sessionStorage; failures (e.g. incognito window) are fine
    if (hasChanges) {
      writeSessionJSON("utm_params", utms);
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
