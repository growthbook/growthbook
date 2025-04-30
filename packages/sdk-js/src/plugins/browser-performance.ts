import type { GrowthBook } from "../GrowthBook";
import type { UserScopedGrowthBook } from "../GrowthBookClient";

type BrowserPerformanceSettings = {
  trackFCP?: boolean;
  trackLCP?: boolean;
  trackFID?: boolean;
  trackCLS?: boolean;
  trackTTFB?: boolean;
  trackTBT?: boolean;
  trackErrors?: boolean;
};

export function browserPerformancePlugin({
  trackFCP = true,
  trackLCP = true,
  trackFID = true,
  trackCLS = true,
  trackTTFB = true,
  trackTBT = true,
  trackErrors = true,
}: BrowserPerformanceSettings = {}) {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("browserPerformancePlugin only works in the browser");
  }

  return (gb: GrowthBook | UserScopedGrowthBook) => {
    if (!gb.logEvent) {
      throw new Error("GrowthBook instance must have a logEvent method");
    }

    if ("PerformanceObserver" in window) {
      try {
        let observing = true;
        const observers: PerformanceObserver[] = [];
        const stopObserving = () => {
          observing = false;
          observers.forEach((observer) => observer.disconnect());
        };

        let lcpTime = 0;
        let clsValue = 0;
        let tbtValue = 0;

        const reportCWV = () => {
          if (!observing) return;
          stopObserving();
          if (trackLCP && lcpTime) {
            gb.logEvent("CWV:LCP", { value: lcpTime });
          }
          if (trackCLS && clsValue) {
            gb.logEvent("CWV:CLS", { value: clsValue });
          }
          if (trackTBT && tbtValue) {
            gb.logEvent("CWV:TBT", { value: tbtValue });
          }
        };

        "onDestroy" in gb && gb.onDestroy(stopObserving);

        const currentPath = window.location.origin + window.location.pathname;

        // Track deferred CWV metrics on navigation
        "navigation" in window &&
          // @ts-expect-error: Navigate API might be missing from types
          window.navigation.addEventListener("navigate", (event) => {
            const destination = event?.destination?.url;
            if (destination) {
              const url = new URL(destination);
              const newPath = url.origin + url.pathname;
              if (newPath !== currentPath) {
                reportCWV();
              }
            }
          });

        // Track deferred CWV metrics on hide
        document.addEventListener("visibilitychange", reportCWV, {
          once: true,
        });

        // FCP
        if (trackFCP || trackTBT) {
          new PerformanceObserver((list, observer) => {
            observers.push(observer);
            const entry = list.getEntriesByName("first-contentful-paint")[0];
            if (entry) {
              observer.disconnect();
              gb.logEvent("CWV:FCP", { value: entry.startTime });
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
              gb.logEvent("CWV:FID", { value: entry.startTime });
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
            "navigation"
          )[0] as PerformanceNavigationTiming;
          if (navEntry) {
            gb.logEvent("CWV:TTFB", { value: navEntry.responseStart });
          }
        }

        // TBT
        if (trackTBT) {
          let fcpTime = 0;
          const fcpEntry = performance.getEntriesByName(
            "first-contentful-paint"
          )[0];
          if (fcpEntry) {
            fcpTime = (fcpEntry as PerformanceEntry).startTime;
          }

          new PerformanceObserver((list, observer) => {
            observers.push(observer);
            for (const entry of list.getEntries()) {
              const blockingTime = Math.max(0, entry.duration - 50);
              if (entry.startTime + entry.duration > fcpTime) {
                tbtValue += blockingTime;
              }
            }
          }).observe({ type: "long-task", buffered: true });
        }
      } catch {
        // noop
      }
    }

    if (trackErrors) {
      window.addEventListener("error", (event) => {
        gb.logEvent("browser-error", {
          message: event.message,
          source: event.filename,
          lineno: event.lineno,
          colno: event.colno,
          stack: event.error?.stack || "",
        });
      });

      window.addEventListener("unhandledrejection", (event) => {
        gb.logEvent("browser-error", {
          message: event.reason?.message || "Unhandled Promise rejection",
          stack: event.reason?.stack || "",
        });
      });
    }
  };
}
