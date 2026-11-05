import Router from "next/router";
import type { PageLoadReport, PageLoadRequestKey } from "shared/validators";
import {
  getApiHost,
  getGrowthBookBuild,
  isPageLoadTimingEnabled,
} from "@/services/env";

export type PageLoadMarkName = "pageMounted" | "pageReady";

type ResourceEntry = Pick<
  PerformanceResourceTiming,
  "name" | "startTime" | "responseEnd" | "transferSize"
>;

type NavigationEntry = Pick<
  PerformanceNavigationTiming,
  "type" | "responseStart" | "domContentLoadedEventEnd"
>;

// The back end refuses times over ten minutes
const MAX_MS = 600_000;

const API_PATHS: Record<string, PageLoadRequestKey> = {
  "/auth/refresh": "authRefresh",
  "/user": "user",
  "/organization": "organization",
  "/organization/definitions": "definitions",
};

function pathOf(url: string): string {
  return url.split(/[?#]/)[0];
}

export function getRequestKey(
  url: string,
  appOrigin: string,
  apiHost: string,
): PageLoadRequestKey | null {
  const path = pathOf(url);
  if (path === `${appOrigin}/api/init`) return "init";
  if (!apiHost || !path.startsWith(`${apiHost}/`)) return null;
  const apiPath = path.slice(apiHost.length);
  if (API_PATHS[apiPath]) return API_PATHS[apiPath];
  if (/^\/feature\/[^/]+$/.test(apiPath)) return "feature";
  return null;
}

export function getRequestTimings(
  entries: ResourceEntry[],
  appOrigin: string,
  apiHost: string,
): PageLoadReport["requests"] {
  const requests: PageLoadReport["requests"] = {};
  entries.forEach((entry) => {
    const key = getRequestKey(entry.name, appOrigin, apiHost);
    if (!key || requests[key]) return;
    requests[key] = {
      start: Math.round(entry.startTime),
      end: Math.round(entry.responseEnd),
      ...(typeof entry.transferSize === "number"
        ? { bytes: entry.transferSize }
        : {}),
    };
  });
  return requests;
}

export type PageLoadReporterDeps = {
  startPath: string;
  appOrigin: string;
  now: () => number;
  enabled: () => boolean;
  build: () => string;
  apiHost: () => string;
  hiddenAt: () => number | undefined;
  navigation: () => NavigationEntry | undefined;
  resources: () => ResourceEntry[];
};

export function createPageLoadReporter(deps: PageLoadReporterDeps) {
  const marks: Partial<Record<PageLoadMarkName, number>> = {};
  let done = false;

  return {
    // Leaving the start path, even briefly, means the document no longer
    // shows one uninterrupted full load
    routeChangeStart(url: string) {
      if (pathOf(url) !== deps.startPath) done = true;
    },

    mark(
      name: PageLoadMarkName,
      route: string,
      last: boolean,
      send: (report: PageLoadReport) => void,
    ) {
      if (done) return;
      const now = deps.now();
      marks[name] ??= now;
      if (!last) return;
      done = true;
      // A page that shows its content on its first render can mark ready
      // before the layout marks it mounted
      const pageMounted = marks.pageMounted ?? now;

      if (!deps.enabled() || now > MAX_MS) return;
      const nav = deps.navigation();
      if (!nav) return;
      const hiddenAt = deps.hiddenAt();

      send({
        route,
        navigationType: nav.type,
        build: deps.build(),
        ...(hiddenAt !== undefined ? { hiddenAt } : {}),
        responseStart: Math.round(nav.responseStart),
        domContentLoaded: Math.round(nav.domContentLoadedEventEnd),
        pageMounted,
        ...(marks.pageReady !== undefined
          ? { pageReady: marks.pageReady }
          : {}),
        requests: getRequestTimings(
          deps.resources(),
          deps.appOrigin,
          deps.apiHost(),
        ),
      });
    },
  };
}

let reporter: ReturnType<typeof createPageLoadReporter> | null = null;

if (typeof window !== "undefined") {
  try {
    performance.setResourceTimingBufferSize(1000);
  } catch (e) {
    // Not supported; the default buffer is still read
  }

  let hiddenAt: number | undefined;
  if (document.visibilityState === "hidden") {
    hiddenAt = 0;
  } else {
    const onVisibilityChange = () => {
      if (document.visibilityState !== "hidden") return;
      hiddenAt = Math.round(performance.now());
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
  }

  reporter = createPageLoadReporter({
    startPath: window.location.pathname,
    appOrigin: window.location.origin,
    now: () => Math.round(performance.now()),
    enabled: isPageLoadTimingEnabled,
    build: () => getGrowthBookBuild().sha.slice(0, 7),
    apiHost: getApiHost,
    hiddenAt: () => hiddenAt,
    navigation: () =>
      performance.getEntriesByType("navigation")[0] as
        | PerformanceNavigationTiming
        | undefined,
    resources: () =>
      performance.getEntriesByType("resource") as PerformanceResourceTiming[],
  });
  Router.events.on("routeChangeStart", reporter.routeChangeStart);
}

export function markPageLoad(
  name: PageLoadMarkName,
  route: string,
  last: boolean,
  send: (report: PageLoadReport) => void,
) {
  reporter?.mark(name, route, last, send);
}
