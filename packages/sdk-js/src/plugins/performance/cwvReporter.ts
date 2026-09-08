import type { GrowthBook } from "../../GrowthBook";
import {
  currentPageUrl,
  detectEnv,
  shouldSample,
  whenActivated,
} from "../util";
import { subscribeToUrlChanges } from "../util/urlChangeObserver";

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

// types are incomplete
type EventTimingEntry = PerformanceEntry & {
  interactionId?: number;
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
  samplingRate = Math.min(1, Math.max(0, samplingRate));
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

  let destroyed = false;
  growthbook.onDestroy(() => {
    destroyed = true;
  });
  whenActivated(() => {
    if (!destroyed) start();
  });

  function start() {
    try {
      let stopped = false;
      let lcpFrozen = false;
      type Observed = {
        observer: PerformanceObserver;
        callback: (list: PerformanceObserverEntryList) => void;
      };
      const observers: Observed[] = [];
      let lcpObserver: PerformanceObserver | null = null;
      let unsubscribeUrlChanges: (() => void) | null = null;
      let removeListeners: (() => void) | null = null;

      // Deferred metrics finalize after an SPA navigation has changed location
      const pageUrl = currentPageUrl();
      const log = (eventName: string, value: number) =>
        growthbook.logEvent(eventName, { value }, { url: pageUrl });

      const observe = (
        type: string,
        callback: Observed["callback"],
        options?: PerformanceObserverInit,
      ) => {
        const observer = safeObserve(type, callback, options);
        observer && observers.push({ observer, callback });
        return observer;
      };

      // Drain queued entries first — observer callbacks are async, and the
      // shift from the click that navigated away is usually still pending
      const stopObserving = () => {
        if (stopped) return;
        stopped = true;
        observers.forEach(({ observer, callback }) => {
          if (typeof observer.takeRecords === "function") {
            const records = observer.takeRecords();
            records.length &&
              callback({
                getEntries: () => records,
                getEntriesByName: (name) =>
                  records.filter((e) => e.name === name),
                getEntriesByType: (t) =>
                  records.filter((e) => e.entryType === t),
              });
          }
          observer.disconnect();
        });
        observers.length = 0;
        lcpObserver = null;
        unsubscribeUrlChanges?.();
        unsubscribeUrlChanges = null;
        removeListeners?.();
        removeListeners = null;
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
        // null checks, not truthiness — 0 is a valid (and good) measurement
        trackLCP &&
          lcpTime !== null &&
          log("CWV:LCP", Math.max(0, lcpTime - activationStart));
        trackCLS && clsValue !== null && log("CWV:CLS", clsValue);
        trackTBT && tbtValue !== null && log("CWV:TBT", tbtValue);
        trackINP && inpValue !== null && log("CWV:INP", inpValue);
      };

      // Prerendered pages measure from activation, matching web-vitals
      const navEntry = performance.getEntriesByType("navigation")[0] as
        | (PerformanceNavigationTiming & { activationStart?: number })
        | undefined;
      const activationStart = navEntry?.activationStart ?? 0;

      // Report deferred metrics on SPA navigations. The location has already
      // changed when this fires, so don't sync the GrowthBook URL first — the
      // metrics belong to the page that was just left.
      unsubscribeUrlChanges = subscribeToUrlChanges(reportCWV, {
        trackQueryString: trackQueryStringChanges,
        enablePolling: enableUrlPolling,
      });

      // Paint metrics from a page that loaded hidden (background tab) would be
      // huge outliers; drop entries after the first hidden moment, per web-vitals
      let firstHiddenTime =
        document.visibilityState === "hidden" ? 0 : Infinity;

      // Only "hidden" finalizes — background tabs start hidden and emit a
      // visible event first, which would prematurely halt observation
      const onVisibilityChange = () => {
        if (document.visibilityState !== "hidden") return;
        firstHiddenTime = Math.min(firstHiddenTime, performance.now());
        reportCWV();
      };
      document.addEventListener("visibilitychange", onVisibilityChange);
      // Older Safari doesn't reliably fire visibilitychange on unload
      window.addEventListener("pagehide", reportCWV);
      removeListeners = () => {
        document.removeEventListener("visibilitychange", onVisibilityChange);
        window.removeEventListener("pagehide", reportCWV);
      };

      // FCP — also used as the start time for TBT
      if (trackFCP || trackTBT) {
        const fcpObserver = observe("paint", (list) => {
          const entry = list.getEntriesByName("first-contentful-paint")[0];
          if (!entry || entry.startTime >= firstHiddenTime) return;
          fcpTime = entry.startTime;
          fcpObserver?.disconnect();
          trackFCP &&
            log("CWV:FCP", Math.max(0, entry.startTime - activationStart));
        });
      }

      // LCP — observe until first input freezes it (per spec) or report time
      if (trackLCP) {
        lcpObserver = observe("largest-contentful-paint", (list) => {
          if (lcpFrozen) return;
          const entries = list.getEntries();
          const lastEntry = entries[entries.length - 1];
          if (lastEntry && lastEntry.startTime < firstHiddenTime) {
            lcpTime = lastEntry.startTime;
          }
        });
      }

      // First-input — used for FID (optional) and to freeze LCP per spec.
      // We attach this whenever LCP is on, even if FID itself isn't reported.
      if (trackFID || trackLCP) {
        let firstInputFired = false;
        const firstInputObserver = observe("first-input", (list) => {
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
            log("CWV:FID", entry.processingStart - entry.startTime);
          }
        });
      }

      // INP — worst duration per interaction (grouped by interactionId), then
      // web-vitals' estimator: step down one candidate per 50 interactions to
      // approximate p98. No interaction → nothing reported.
      if (trackINP) {
        const MAX_CANDIDATES = 10;
        const worstByInteraction = new Map<number, number>();
        let seenInteractions = 0;
        observe(
          "event",
          (list) => {
            for (const entry of list.getEntries() as EventTimingEntry[]) {
              const id = entry.interactionId;
              if (!id) continue;
              const prev = worstByInteraction.get(id);
              if (prev === undefined) seenInteractions++;
              if (prev === undefined || entry.duration > prev) {
                worstByInteraction.set(id, entry.duration);
              }
              if (worstByInteraction.size > MAX_CANDIDATES) {
                let minId = 0;
                let minDuration = Infinity;
                worstByInteraction.forEach((d, i) => {
                  if (d < minDuration) {
                    minDuration = d;
                    minId = i;
                  }
                });
                worstByInteraction.delete(minId);
              }
            }
            if (!worstByInteraction.size) return;
            // counts every interaction, not just those over the 40ms threshold
            const count =
              (performance as { interactionCount?: number }).interactionCount ??
              seenInteractions;
            const sorted = Array.from(worstByInteraction.values()).sort(
              (a, b) => b - a,
            );
            inpValue =
              sorted[Math.min(Math.floor(count / 50), sorted.length - 1)];
          },
          { durationThreshold: 40 } as PerformanceObserverInit,
        );
      }

      // CLS — session-windowed (5s window / 1s gap), max session sum
      if (trackCLS) {
        clsValue = 0;
        let sessionValue = 0;
        let firstSessionEntryTime = 0;
        let lastSessionEntryTime = 0;
        observe("layout-shift", (list) => {
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
      }

      // TTFB
      // responseStart is 0 for some cross-origin redirect chains
      if (trackTTFB && navEntry && navEntry.responseStart > 0) {
        log("CWV:TTFB", Math.max(0, navEntry.responseStart - activationStart));
      }

      // TBT — sum of (effectiveDuration - 50ms) for the post-FCP portion of
      // each long task. Pre-FCP segments contribute 0.
      if (trackTBT) {
        tbtValue = 0;
        observe("longtask", (list) => {
          // Fall back to getEntriesByName if the paint observer hasn't fired
          // yet, so buffered long-tasks aren't silently dropped
          if (fcpTime === null) {
            const fcp = performance.getEntriesByName(
              "first-contentful-paint",
            )[0];
            fcp && (fcpTime = fcp.startTime);
          }
          if (fcpTime === null) return;
          for (const entry of list.getEntries()) {
            const taskStart = Math.max(entry.startTime, fcpTime);
            const taskEnd = entry.startTime + entry.duration;
            if (taskEnd <= taskStart) continue;
            // 50ms is the long-task threshold
            tbtValue = (tbtValue ?? 0) + Math.max(0, taskEnd - taskStart - 50);
          }
        });
      }
    } catch {
      // noop — observability shouldn't crash the host page
    }
  }
}
