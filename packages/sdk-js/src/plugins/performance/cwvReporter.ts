import { GrowthBook } from "../../GrowthBook";
import type {
  GrowthBookClient,
  UserScopedGrowthBook,
} from "../../GrowthBookClient";
import { detectEnv, shouldSample } from "./util";

export type CWVReporterSettings = {
  trackFCP?: boolean;
  trackLCP?: boolean;
  trackFID?: boolean;
  trackCLS?: boolean;
  trackTTFB?: boolean;
  trackTBT?: boolean;
  // sampling:
  samplingRate?: number;
  hashAttribute?: string;
  growthbook: GrowthBook | UserScopedGrowthBook | GrowthBookClient;
};

export function createCWVReporter({
  trackFCP = true,
  trackLCP = true,
  trackFID = true,
  trackCLS = true,
  trackTTFB = true,
  trackTBT = true,
  samplingRate = 1,
  hashAttribute = "id",
  growthbook,
}: CWVReporterSettings) {
  if (samplingRate < 0 || samplingRate > 1) {
    throw new Error("samplingRate must be between 0 and 1");
  }
  const env = detectEnv();
  if (env !== "browser") {
    throw new Error("CWV reporting only works in the browser");
  }
  if (!(growthbook instanceof GrowthBook)) {
    throw new Error("CWV reporting requires a GrowthBook instance");
  }

  if (
    !shouldSample({
      rate: samplingRate,
      hashAttribute,
      attributes: growthbook.getAttributes(),
      seed: "cwv-sampling",
    })
  ) {
    return;
  }

  if (!("PerformanceObserver" in window)) {
    console.error("PerformanceObserver is unavailable");
    return;
  }

  try {
    let observing = true;
    const observers: PerformanceObserver[] = [];
    const stopObserving = () => {
      observing = false;
      urlPolling = false;
      observers.forEach((observer) => observer.disconnect());
    };
    "onDestroy" in growthbook && growthbook.onDestroy(stopObserving);

    let lcpTime = 0;
    let clsValue = 0;
    let tbtValue = 0;

    let currentPath = window.location.origin + window.location.pathname;

    const reportCWV = () => {
      if (!observing) return;
      stopObserving();
      if (trackLCP && lcpTime) {
        growthbook.logEvent("CWV:LCP", { value: lcpTime });
      }
      if (trackCLS && clsValue) {
        growthbook.logEvent("CWV:CLS", { value: clsValue });
      }
      if (trackTBT && tbtValue) {
        growthbook.logEvent("CWV:TBT", { value: tbtValue });
      }
    };

    const reportIfUrlChanged = (newPath: string) => {
      if (newPath !== currentPath) {
        currentPath = newPath;
        reportCWV();
      }
    };

    // Track deferred CWV metrics on navigation (new API, not widely supported yet)
    if ("navigation" in window) {
      // @ts-expect-error: Navigate API might be missing from types
      window.navigation.addEventListener("navigate", (event) => {
        if (event?.destination?.url) {
          try {
            const url = new URL(event.destination.url);
            reportIfUrlChanged(url.origin + url.pathname);
          } catch {
            // Invalid URL, ignore
          }
        }
      });
    }

    // Track using history changes
    const methods = ["pushState", "replaceState"] as const;
    methods.forEach((method) => {
      const original = window.history[method];
      window.history[method] = function (...args) {
        const result = original.apply(this, args);
        reportIfUrlChanged(window.location.origin + window.location.pathname);
        return result;
      };
    });
    window.addEventListener("popstate", () => {
      reportIfUrlChanged(window.location.origin + window.location.pathname);
    });

    // Track using legacy url-change polling strategy
    let urlPolling = true;
    const checkForUrlChanges = () => {
      if (!urlPolling) return;
      reportIfUrlChanged(window.location.origin + window.location.pathname);
      setTimeout(checkForUrlChanges, 500);
    };
    checkForUrlChanges();

    // Track deferred CWV metrics on hide
    document.addEventListener("visibilitychange", reportCWV, {
      once: true,
    });

    let fcpTime: number | null = null;

    // FCP
    if (trackFCP || trackTBT) {
      new PerformanceObserver((list, observer) => {
        observers.push(observer);
        const entry = list.getEntriesByName("first-contentful-paint")[0];
        if (entry) {
          observer.disconnect();
          fcpTime = entry.startTime;
          if (trackFCP) {
            growthbook.logEvent("CWV:FCP", { value: entry.startTime });
          }
        }
      }).observe({ type: "paint", buffered: true });
    }

    // LCP
    if (trackLCP) {
      new PerformanceObserver((list, observer) => {
        observers.push(observer);
        const entries = list.getEntries();
        const lastEntry = entries[entries.length - 1];
        if (lastEntry) {
          lcpTime = lastEntry.startTime;
        }
      }).observe({ type: "largest-contentful-paint", buffered: true });
    }

    // FID
    if (trackFID) {
      new PerformanceObserver((list, observer) => {
        observers.push(observer);
        list.getEntries().forEach((entry) => {
          observer.disconnect();
          growthbook.logEvent("CWV:FID", { value: entry.startTime });
        });
      }).observe({ type: "first-input", buffered: true });
    }

    // CLS
    if (trackCLS) {
      new PerformanceObserver((list, observer) => {
        observers.push(observer);
        list.getEntries().forEach((entry) => {
          // @ts-expect-error: types are incomplete
          if (!entry.hadRecentInput) {
            // @ts-expect-error: types are incomplete
            clsValue += entry.value ?? 0;
          }
        });
      }).observe({ type: "layout-shift", buffered: true });
    }

    // TTFB
    if (trackTTFB) {
      const navEntry = performance.getEntriesByType(
        "navigation",
      )[0] as PerformanceNavigationTiming;
      if (navEntry) {
        growthbook.logEvent("CWV:TTFB", { value: navEntry.responseStart });
      }
    }

    // TBT
    if (trackTBT) {
      new PerformanceObserver((list, observer) => {
        observers.push(observer);
        for (const entry of list.getEntries()) {
          if (fcpTime != null && entry.startTime + entry.duration > fcpTime) {
            tbtValue += Math.max(0, entry.duration - 50); // 50ms is the threshold for long tasks
          }
          // If fcpTime is not set, ignore this long task
        }
      }).observe({ type: "longtask", buffered: true });
    }
  } catch {
    // noop
  }
}
