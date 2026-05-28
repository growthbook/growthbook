import type { GrowthBook } from "../../GrowthBook";
import { detectEnv, shouldSample, syncGrowthBookUrl } from "./util";
import { subscribeToUrlChanges } from "./urlChangeObserver";

export type CWVReporterSettings = {
  trackFCP?: boolean;
  trackLCP?: boolean;
  // FID is deprecated in favor of INP; off by default
  trackFID?: boolean;
  trackINP?: boolean;
  trackCLS?: boolean;
  trackTTFB?: boolean;
  trackTBT?: boolean;
  // sampling:
  samplingRate?: number;
  hashAttribute?: string;
  samplingSeed?: string;
  // Also finalize CWV on query-string changes (default: pathname-only)
  trackQueryStringChanges?: boolean;
  enableUrlPolling?: boolean;
  // GrowthBook only — needs getAttributes + onDestroy
  growthbook: GrowthBook;
};

// types are incomplete
type LayoutShiftEntry = PerformanceEntry & {
  hadRecentInput: boolean;
  value: number;
};

// types are incomplete
type FirstInputEntry = PerformanceEntry & {
  processingStart: number;
};

function safeObserve(
  type: string,
  callback: (list: PerformanceObserverEntryList) => void,
  options?: PerformanceObserverInit,
): PerformanceObserver | null {
  try {
    const observer = new PerformanceObserver(callback);
    observer.observe({ type, buffered: true, ...options });
    return observer;
  } catch {
    // entry type unsupported, ignore
    return null;
  }
}

export function createCWVReporter({
  trackFCP = true,
  trackLCP = true,
  trackFID = false,
  trackINP = true,
  trackCLS = true,
  trackTTFB = true,
  trackTBT = true,
  samplingRate = 1,
  hashAttribute = "id",
  samplingSeed,
  trackQueryStringChanges = false,
  enableUrlPolling = false,
  growthbook,
}: CWVReporterSettings) {
  if (samplingRate < 0 || samplingRate > 1) {
    throw new Error("samplingRate must be between 0 and 1");
  }
  if (detectEnv() !== "browser") return;
  // Duck-type rather than instanceof so multi-bundle setups (CDN + npm) work
  if (
    !growthbook ||
    typeof growthbook.getAttributes !== "function" ||
    typeof growthbook.onDestroy !== "function" ||
    typeof growthbook.logEvent !== "function"
  ) {
    throw new Error("CWV reporting requires a GrowthBook instance");
  }

  if (
    !shouldSample({
      rate: samplingRate,
      hashAttribute,
      attributes: growthbook.getAttributes(),
      seed: samplingSeed ?? "cwv-sampling",
    })
  ) {
    return;
  }

  if (!("PerformanceObserver" in window)) {
    return;
  }

  try {
    let stopped = false;
    let lcpFrozen = false;
    const observers: PerformanceObserver[] = [];
    let lcpObserver: PerformanceObserver | null = null;
    let unsubscribeUrlChanges: (() => void) | null = null;
    let removeVisibilityListener: (() => void) | null = null;

    const stopObserving = () => {
      if (stopped) return;
      stopped = true;
      observers.forEach((o) => o.disconnect());
      observers.length = 0;
      lcpObserver = null;
      unsubscribeUrlChanges?.();
      unsubscribeUrlChanges = null;
      removeVisibilityListener?.();
      removeVisibilityListener = null;
    };

    growthbook.onDestroy(stopObserving);

    let fcpTime: number | null = null;
    let lcpTime: number | null = null;
    let clsValue: number | null = null;
    let tbtValue: number | null = null;
    let inpValue: number | null = null;

    const reportCWV = () => {
      if (stopped) return;
      stopObserving();
      syncGrowthBookUrl(growthbook);
      // `!= null` so 0 is a valid (and good) measurement
      trackLCP &&
        lcpTime != null &&
        growthbook.logEvent("CWV:LCP", { value: lcpTime });
      trackCLS &&
        clsValue != null &&
        growthbook.logEvent("CWV:CLS", { value: clsValue });
      trackTBT &&
        tbtValue != null &&
        growthbook.logEvent("CWV:TBT", { value: tbtValue });
      trackINP &&
        inpValue != null &&
        growthbook.logEvent("CWV:INP", { value: inpValue });
    };

    // Report deferred metrics on SPA navigations and on hide
    unsubscribeUrlChanges = subscribeToUrlChanges(reportCWV, {
      trackQueryString: trackQueryStringChanges,
      enablePolling: enableUrlPolling,
    });

    // Only fire on "hidden" — bg tabs and prerenders start hidden and emit
    // a visible event first, which would prematurely halt observation
    const onVisibilityChange = () => {
      document.visibilityState === "hidden" && reportCWV();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    removeVisibilityListener = () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);

    // FCP — also used as the start time for TBT
    if (trackFCP || trackTBT) {
      const fcpObserver = safeObserve("paint", (list) => {
        const entry = list.getEntriesByName("first-contentful-paint")[0];
        if (!entry) return;
        fcpTime = entry.startTime;
        fcpObserver?.disconnect();
        trackFCP && growthbook.logEvent("CWV:FCP", { value: entry.startTime });
      });
      fcpObserver && observers.push(fcpObserver);
    }

    // LCP — observe until first input freezes it (per spec) or report time
    if (trackLCP) {
      lcpObserver = safeObserve("largest-contentful-paint", (list) => {
        if (lcpFrozen) return;
        const entries = list.getEntries();
        const lastEntry = entries[entries.length - 1];
        lastEntry && (lcpTime = lastEntry.startTime);
      });
      lcpObserver && observers.push(lcpObserver);
    }

    // First-input — used for FID (optional) and to freeze LCP per spec.
    // We attach this whenever LCP is on, even if FID itself isn't reported.
    if (trackFID || trackLCP) {
      let firstInputFired = false;
      const firstInputObserver = safeObserve("first-input", (list) => {
        if (firstInputFired) return;
        const entry = list.getEntries()[0] as FirstInputEntry | undefined;
        if (!entry) return;
        firstInputFired = true;
        firstInputObserver?.disconnect();
        // Freeze LCP at its current value
        if (trackLCP) {
          lcpFrozen = true;
          lcpObserver?.disconnect();
        }
        if (trackFID) {
          const delay = entry.processingStart - entry.startTime;
          growthbook.logEvent("CWV:FID", { value: delay });
        }
      });
      firstInputObserver && observers.push(firstInputObserver);
    }

    // INP — worst event-timing duration; 40ms threshold catches near-misses
    if (trackINP) {
      inpValue = 0;
      const inpObserver = safeObserve(
        "event",
        (list) => {
          for (const entry of list.getEntries() as PerformanceEventTiming[]) {
            if (entry.duration > (inpValue ?? 0)) inpValue = entry.duration;
          }
        },
        { durationThreshold: 40 } as PerformanceObserverInit,
      );
      inpObserver && observers.push(inpObserver);
    }

    // CLS — session-windowed (5s window / 1s gap), max session sum
    if (trackCLS) {
      clsValue = 0;
      let sessionValue = 0;
      let firstSessionEntryTime = 0;
      let lastSessionEntryTime = 0;
      const clsObserver = safeObserve("layout-shift", (list) => {
        for (const entry of list.getEntries() as LayoutShiftEntry[]) {
          if (entry.hadRecentInput) continue;
          // Start a new session if the gap or window threshold is exceeded
          if (
            sessionValue &&
            (entry.startTime - lastSessionEntryTime > 1000 ||
              entry.startTime - firstSessionEntryTime > 5000)
          ) {
            sessionValue = 0;
          }
          if (sessionValue === 0) firstSessionEntryTime = entry.startTime;
          sessionValue += entry.value || 0;
          lastSessionEntryTime = entry.startTime;
          if (sessionValue > (clsValue ?? 0)) clsValue = sessionValue;
        }
      });
      clsObserver && observers.push(clsObserver);
    }

    // TTFB
    if (trackTTFB) {
      const navEntry = performance.getEntriesByType("navigation")[0] as
        | (PerformanceNavigationTiming & { activationStart?: number })
        | undefined;
      if (navEntry) {
        // activationStart subtracts prerender time; 0 otherwise
        const activationStart = navEntry.activationStart ?? 0;
        growthbook.logEvent("CWV:TTFB", {
          value: Math.max(0, navEntry.responseStart - activationStart),
        });
      }
    }

    // TBT — sum of (effectiveDuration - 50ms) for the post-FCP portion of
    // each long task. Pre-FCP segments contribute 0.
    if (trackTBT) {
      tbtValue = 0;
      const tbtObserver = safeObserve("longtask", (list) => {
        // Fall back to getEntriesByName if the paint observer hasn't fired
        // yet, so buffered long-tasks aren't silently dropped
        if (fcpTime == null) {
          const fcp = performance.getEntriesByName("first-contentful-paint")[0];
          fcp && (fcpTime = fcp.startTime);
        }
        if (fcpTime == null) return;
        for (const entry of list.getEntries()) {
          const taskStart = Math.max(entry.startTime, fcpTime);
          const taskEnd = entry.startTime + entry.duration;
          if (taskEnd <= taskStart) continue;
          // 50ms is the long-task threshold
          tbtValue = (tbtValue ?? 0) + Math.max(0, taskEnd - taskStart - 50);
        }
      });
      tbtObserver && observers.push(tbtObserver);
    }
  } catch {
    // noop — observability shouldn't crash the host page
  }
}
