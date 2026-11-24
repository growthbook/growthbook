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
import { visualEditorPlugin } from "./plugins/visual-editor";
import { urlRedirectsPlugin } from "./plugins/url-redirects";
import {
  legacyAutoExperimentPlugins,
  LegacyAutoExperimentOptions,
} from "./legacy-auto-experiments";

// This file builds two kinds of bundle, set by rollup.config.mjs:
//
// - auto.min.js has every feature and behaves as it did before 3.0. It runs
//   visual editor and URL redirect experiments unless a `disable*` setting
//   says not to.
// - The script bundles (core.min.js, core-visual.min.js, ...) only contain the
//   features in their name. Custom JavaScript and cross-origin redirects are
//   each a separate setting on the page.
// @ts-expect-error replaced by the build with true or false
const AUTO: boolean = __GB_AUTO__;
// @ts-expect-error replaced by the build with true or false
const VISUAL: boolean = __GB_VISUAL__;
// @ts-expect-error replaced by the build with true or false
const REDIRECTS: boolean = __GB_REDIRECTS__;

// The script bundles ignore the `disable*` options and take these two instead
type AutoExperimentSettings = LegacyAutoExperimentOptions & {
  allowCustomJs?: boolean;
  allowCrossOriginRedirects?: boolean;
};

type WindowContext = Context &
  AutoExperimentSettings & {
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

// An on/off data attribute. In the script bundles "off", "false" and "0" are
// off and anything else is on, including no value. auto.min.js keeps its old
// rule, where any non-empty value is on, even "false".
function isOn(value: string | undefined): boolean {
  if (AUTO) return !!value;
  return (
    value !== undefined &&
    !["off", "false", "0"].includes(value.trim().toLowerCase())
  );
}

// GrowthBook options that are on/off, so the script bundles read their data
// attributes with isOn. This fails to compile when a new one is left out.
type BooleanOption = {
  [K in keyof Context]-?: NonNullable<Context[K]> extends boolean ? K : never;
}[keyof Context];
const BOOLEAN_OPTIONS: Record<BooleanOption, true> = {
  enabled: true,
  disableExperimentsOnLoad: true,
  debug: true,
  qaMode: true,
  backgroundSync: true,
  subscribeToChanges: true,
  enableDevMode: true,
  disableCache: true,
  disableDevTools: true,
  remoteEval: true,
  antiFlicker: true,
};
const dataOptions: Record<string, string | boolean | undefined> = {
  ...dataContext,
};
if (!AUTO) {
  for (const key in BOOLEAN_OPTIONS) {
    if (key in dataContext) dataOptions[key] = isOn(dataContext[key]);
  }
}

const antiFlicker = windowContext.antiFlicker || isOn(dataContext.antiFlicker);

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

if (antiFlicker) {
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
    uuidAutoPersist:
      !uuid &&
      (AUTO
        ? dataContext.noAutoCookies === undefined
        : !isOn(dataContext.noAutoCookies)),
  }),
];

const tracking = dataContext.tracking || "gtag,gtm,segment";
if (tracking !== "none") {
  const trackers = tracking
    .toLowerCase()
    .split(",")
    .map((t) => t.trim());

  if (trackers.includes("growthbook")) {
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

const autoExperiments: AutoExperimentSettings = {
  ...dataContext,
  ...windowContext,
};
if (AUTO) {
  plugins.push(...legacyAutoExperimentPlugins(autoExperiments));
} else {
  const allowed = (key: "allowCustomJs" | "allowCrossOriginRedirects") =>
    windowContext[key] ?? isOn(dataContext[key]);
  if (VISUAL) {
    plugins.push(
      visualEditorPlugin({
        allowCustomJs: allowed("allowCustomJs"),
        jsInjectionNonce: autoExperiments.jsInjectionNonce,
        applyDomChangesCallback: autoExperiments.applyDomChangesCallback,
      }),
    );
  }
  if (REDIRECTS) {
    plugins.push(
      urlRedirectsPlugin({
        allowCrossOriginRedirects: allowed("allowCrossOriginRedirects"),
        navigate: autoExperiments.navigate,
        navigateDelay: autoExperiments.navigateDelay,
        maxNavigateDelay: autoExperiments.maxNavigateDelay,
      }),
    );
  }
}

// Create GrowthBook instance
const gb = new GrowthBook({
  enableDevMode: true,
  ...dataOptions,
  remoteEval: isOn(dataContext.remoteEval),
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
    isOn(dataContext.noStreaming) ||
    windowContext.backgroundSync === false
  ),
  cacheSettings: windowContext.cacheSettings,
}).then(() => {
  if (!antiFlicker) return;

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
