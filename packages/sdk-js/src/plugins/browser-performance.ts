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
  // Browser only
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("performanceMonitoringPlugin only works in the browser");
  }

  return (gb: GrowthBook | UserScopedGrowthBook) => {
    if (!gb.logEvent) {
      throw new Error("GrowthBook instance must have a logEvent method");
    }

    // Core web vitals
    if ("PerformanceObserver" in window) {
      try {
        const observers: PerformanceObserver[] = [];
        const stopObserving = () =>
          observers.forEach((observer) => observer.disconnect());

        // Listen to various cleanup events to remove PerformanceObservers
        // GB onDestroy call:
        "onDestroy" in gb && gb.onDestroy(() => stopObserving);

        // Navigation to a new path (SPA) via navigation API:
        const urlPath = window.location.origin + window.location.pathname;
        "navigation" in window &&
          // @ts-expect-error: new Navigate API may not be in types yet
          window?.navigation?.addEventListener("navigate", (event) => {
            const destination = event?.destination?.url;
            if (destination) {
              const url = new URL(destination);
              const newPath = url.origin + url.pathname;
              if (newPath !== urlPath) {
                stopObserving();
              }
            }
          });

        // Only track each CWV if it happened before the screen was hidden
        // Otherwise it right-skews the data
        let hiddenTime = document.visibilityState === "hidden" ? 0 : Infinity;
        document.addEventListener(
          "visibilitychange",
          (event) => {
            hiddenTime = Math.min(hiddenTime, event.timeStamp);
          },
          { once: true }
        );

        // FCP (First Contentful Paint)
        let fcpTime = 0; // store FCP offset TBT metric
        if (trackFCP || trackTBT) {
          new PerformanceObserver((list, observer) => {
            observers.push(observer);
            list.getEntriesByName("first-contentful-paint").forEach((entry) => {
              fcpTime = entry.startTime;
              observer.disconnect();
              if (trackFCP && fcpTime < hiddenTime)
                gb.logEvent("CWV:FCP", { value: fcpTime });
            });
          }).observe({ type: "paint", buffered: true });
        }

        // LCP (Largest Contentful Paint)
        if (trackLCP) {
          new PerformanceObserver((list, observer) => {
            observers.push(observer);
            const entries = list.getEntries();
            const lastEntry = entries[entries.length - 1];
            observer.disconnect();
            if (lastEntry.startTime < hiddenTime)
              gb.logEvent("CWV:LCP", { value: lastEntry.startTime });
          }).observe({ type: "largest-contentful-paint", buffered: true });
        }

        // FID (First Input Delay)
        if (trackFID) {
          new PerformanceObserver((list, observer) => {
            observers.push(observer);
            list.getEntries().forEach((entry) => {
              observer.disconnect();
              if (entry.startTime < hiddenTime)
                gb.logEvent("CWV:FID", { value: entry.startTime });
            });
          }).observe({ type: "first-input", buffered: true });
        }

        // CLS (Cumulative Layout Shift)
        if (trackCLS) {
          new PerformanceObserver((list, observer) => {
            observers.push(observer);
            let cls = 0;
            list.getEntries().forEach((entry) => {
              // @ts-expect-error: types are incomplete
              if (!entry?.hadRecentInput) {
                // @ts-expect-error: types are incomplete
                cls += entry?.value ?? 0;
              }
            });
            gb.logEvent("CWV:CLS", { value: cls });
          }).observe({ type: "layout-shift", buffered: true });
        }

        // TTFB (Time to First Byte)
        if (trackTTFB) {
          const navEntry = performance.getEntriesByType(
            "navigation"
          )[0] as PerformanceNavigationTiming;
          if (navEntry) {
            gb.logEvent("CWV:TTFB", { value: navEntry.responseStart });
          }
        }

        // TBT (Total Blocking Time)
        if (trackTBT) {
          let tbt = 0;
          new PerformanceObserver((list, observer) => {
            observers.push(observer);
            for (const entry of list.getEntries()) {
              const blockingTime = Math.max(0, entry.duration - 50);
              // Only considered blocking if occurred after FCP
              if (entry.startTime + entry.duration > fcpTime) {
                tbt += blockingTime;
              }
            }
            gb.logEvent("CWV:TBT", { value: tbt });
          }).observe({ type: "long-task", buffered: true });
        }
      } catch (e) {
        // PerformanceObserver not fully supported
      }
    }

    // JavaScript Errors
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
