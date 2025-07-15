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
  maxErrors?: number;
  debounceErrorTimeout?: number;
};

export function browserPerformancePlugin({
  trackFCP = true,
  trackLCP = true,
  trackFID = true,
  trackCLS = true,
  trackTTFB = true,
  trackTBT = true,
  trackErrors = true,
  maxErrors = 10,
  debounceErrorTimeout = 2000,
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
        "onDestroy" in gb && gb.onDestroy(stopObserving);

        let lcpTime = 0;
        let clsValue = 0;
        let tbtValue = 0;

        const currentPath = window.location.origin + window.location.pathname;

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
        const reportIfUrlChanged = (destinationUrl: string) => {
          const url = new URL(destinationUrl);
          const newPath = url.origin + url.pathname;
          if (newPath !== currentPath) {
            reportCWV();
          }
        };

        // Track deferred CWV metrics on navigation / url changes
        if ("navigation" in window) {
          // @ts-expect-error: Navigate API might be missing from types
          window.navigation.addEventListener("navigate", (event) => {
            if (event?.destination?.url) {
              reportIfUrlChanged(event.destination.url);
            }
          });
        } else {
          const methods = ["pushState", "replaceState"] as const;
          methods.forEach((method) => {
            const original = window.history[method];
            window.history[method] = function (...args) {
              const result = original.apply(this, args);
              reportIfUrlChanged(window.location.href);
              return result;
            };
          });
          window.addEventListener("popstate", () => {
            reportIfUrlChanged(window.location.href);
          });
        }

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
                gb.logEvent("CWV:FCP", { value: entry.startTime });
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
          new PerformanceObserver((list, observer) => {
            observers.push(observer);
            for (const entry of list.getEntries()) {
              if (
                fcpTime != null &&
                entry.startTime + entry.duration > fcpTime
              ) {
                tbtValue += Math.max(0, entry.duration - 50); // 50ms is the threshold for long tasks
              }
              // If fcpTime is not set, ignore this long task
            }
          }).observe({ type: "long-task", buffered: true });
        }
      } catch {
        // noop
      }
    }

    // Only log errors if < maxErrors
    let errorCount = 0;
    // Debounce identical errors
    const lastErrorTimestamps = new Map<string, number>();

    function shouldLogError(message: string, stack: string) {
      if (errorCount >= maxErrors) return false;
      const key = message + stack;
      if (debounceErrorTimeout > 0) {
        const now = Date.now();
        const last = lastErrorTimestamps.get(key) || 0;
        if (now - last < debounceErrorTimeout) {
          return false;
        }
        lastErrorTimestamps.set(key, now);
      }
      errorCount++;
      return true;
    }

    if (trackErrors) {
      window.addEventListener("error", (event) => {
        const message = event.message || "";
        const stack = event.error?.stack || "";
        if (shouldLogError(message, stack)) {
          gb.logEvent("browser-error", {
            message,
            source: event.filename,
            lineno: event.lineno,
            colno: event.colno,
            stack,
          });
        }
      });

      window.addEventListener("unhandledrejection", (event) => {
        const message = event.reason?.message || "Unhandled Promise rejection";
        const stack = event.reason?.stack || "";
        if (shouldLogError(message, stack)) {
          gb.logEvent("browser-error", {
            message,
            stack,
          });
        }
      });
    }
  };
}
