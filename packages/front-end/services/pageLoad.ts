import type { PageLoadReport, PageLoadRequestKey } from "shared/validators";
import {
  getApiHost,
  getGrowthBookBuild,
  isPageLoadTimingEnabled,
} from "@/services/env";

// Timings for one full document load, sent to the back end's log at most once.

export type PageLoadMarkName = "pageMounted" | "pageReady";

type ResourceEntry = Pick<
  PerformanceResourceTiming,
  "name" | "startTime" | "responseEnd" | "transferSize"
>;

// The back end refuses times over ten minutes
const MAX_MS = 600_000;

const API_PATHS: Record<string, PageLoadRequestKey> = {
  "/auth/refresh": "authRefresh",
  "/user": "user",
  "/organization": "organization",
  "/organization/definitions": "definitions",
};

export function getRequestKey(
  url: string,
  appOrigin: string,
  apiHost: string,
): PageLoadRequestKey | null {
  const path = url.split(/[?#]/)[0];
  if (path === `${appOrigin}/api/init`) return "init";
  if (!apiHost || !path.startsWith(`${apiHost}/`)) return null;
  const apiPath = path.slice(apiHost.length);
  if (API_PATHS[apiPath]) return API_PATHS[apiPath];
  if (/^\/feature\/[^/]+$/.test(apiPath)) return "feature";
  return null;
}

// The first call to each path the report covers
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

const startPath =
  typeof window !== "undefined" ? window.location.pathname : null;
const marks: Partial<Record<PageLoadMarkName, number>> = {};
let hiddenAt: number | undefined;
let done = false;

if (typeof window !== "undefined") {
  try {
    performance.setResourceTimingBufferSize(1000);
  } catch (e) {
    // Not supported; the default buffer is still read
  }
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
}

// Records a mark, and with `last` sends the report. Nothing is sent if the
// path changed since the document loaded.
export function markPageLoad(
  name: PageLoadMarkName,
  route: string,
  last: boolean,
  send: (report: PageLoadReport) => void,
) {
  if (done || typeof window === "undefined") return;
  if (window.location.pathname !== startPath) {
    done = true;
    return;
  }
  const now = Math.round(performance.now());
  marks[name] ??= now;
  if (!last) return;
  done = true;
  // A page that shows its content on its first render can mark ready before
  // the layout marks it mounted
  const pageMounted = marks.pageMounted ?? now;

  if (!isPageLoadTimingEnabled() || now > MAX_MS) return;
  const nav = performance.getEntriesByType("navigation")[0] as
    | PerformanceNavigationTiming
    | undefined;
  if (!nav) return;

  send({
    route,
    navigationType: nav.type,
    build: getGrowthBookBuild().sha.slice(0, 7),
    ...(hiddenAt !== undefined ? { hiddenAt } : {}),
    responseStart: Math.round(nav.responseStart),
    domContentLoaded: Math.round(nav.domContentLoadedEventEnd),
    pageMounted,
    ...(marks.pageReady !== undefined ? { pageReady: marks.pageReady } : {}),
    requests: getRequestTimings(
      performance.getEntriesByType("resource") as PerformanceResourceTiming[],
      window.location.origin,
      getApiHost(),
    ),
  });
}
