import type { GrowthBook } from "../../GrowthBook";
import { DEFAULT_SAMPLING_SEED, shouldSample } from "../utils/sampling";
import { currentPageUrl, detectEnv, whenActivated } from "../utils/browser";
import { subscribeToUrlChanges } from "../utils/url-change-observer";

const noop = () => {};

export type CWVReporterSettings = {
  trackFCP?: boolean;
  trackLCP?: boolean;
  trackINP?: boolean;
  trackCLS?: boolean;
  trackTTFB?: boolean;
  trackTBT?: boolean;
  samplingRate?: number;
  hashAttribute?: string;
  samplingSeed?: string;
  // Also finalize CWV on query-string changes (default: pathname-only)
  trackQueryStringChanges?: boolean;
  growthbook: GrowthBook;
};

type LayoutShiftEntry = PerformanceEntry & {
  hadRecentInput: boolean;
  value: number;
};

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
    return null; // entry type unsupported
  }
}

export function createCWVReporter({
  trackFCP = true,
  trackLCP = true,
  trackINP = true,
  trackCLS = true,
  trackTTFB = true,
  trackTBT = true,
  samplingRate = 1,
  hashAttribute = "id",
  samplingSeed,
  trackQueryStringChanges = false,
  growthbook,
}: CWVReporterSettings): () => void {
  samplingRate = Math.min(1, Math.max(0, samplingRate));
  if (detectEnv() !== "browser") return noop;
  if (
    !shouldSample({
      rate: samplingRate,
      hashAttribute,
      attributes: growthbook.getAttributes(),
      seed: samplingSeed ?? DEFAULT_SAMPLING_SEED,
    })
  ) {
    return noop;
  }

  if (!("PerformanceObserver" in window)) {
    return noop;
  }

  let destroyed = false;
  let stopObserving: (() => void) | null = null;
  const stop = () => {
    destroyed = true;
    stopObserving && stopObserving();
  };
  growthbook.onDestroy(stop);
  whenActivated(() => {
    if (!destroyed) start();
  });
  return stop;

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
      const stopThisPage = () => {
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
        unsubscribeUrlChanges && unsubscribeUrlChanges();
        unsubscribeUrlChanges = null;
        removeListeners && removeListeners();
        removeListeners = null;
      };
      stopObserving = stopThisPage;

      let fcpTime: number | null = null;
      let lcpTime: number | null = null;
      let clsValue: number | null = null;
      let tbtValue: number | null = null;
      let inpValue: number | null = null;

      const reportCWV = () => {
        if (stopped) return;
        stopThisPage();
        // null checks, not truthiness — 0 is a valid (and good) measurement
        trackLCP &&
          lcpTime !== null &&
          log("cwv_lcp", Math.max(0, lcpTime - activationStart));
        trackCLS && clsValue !== null && log("cwv_cls", clsValue);
        trackTBT && tbtValue !== null && log("cwv_tbt", tbtValue);
        trackINP && inpValue !== null && log("cwv_inp", inpValue);
      };

      // Prerendered pages measure from activation, matching web-vitals
      const navEntry = performance.getEntriesByType("navigation")[0] as
        | (PerformanceNavigationTiming & { activationStart?: number })
        | undefined;
      const activationStart = (navEntry && navEntry.activationStart) ?? 0;

      // Fires after location has changed; the metrics belong to the page left
      unsubscribeUrlChanges = subscribeToUrlChanges(reportCWV, {
        trackQueryString: trackQueryStringChanges,
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
          fcpObserver && fcpObserver.disconnect();
          trackFCP &&
            log("cwv_fcp", Math.max(0, entry.startTime - activationStart));
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

      // First input freezes LCP per spec
      if (trackLCP) {
        const firstInputObserver = observe("first-input", (list) => {
          if (!list.getEntries().length) return;
          firstInputObserver && firstInputObserver.disconnect();
          lcpFrozen = true;
          lcpObserver && lcpObserver.disconnect();
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

      // responseStart is 0 for some cross-origin redirect chains
      if (trackTTFB && navEntry && navEntry.responseStart > 0) {
        log("cwv_ttfb", Math.max(0, navEntry.responseStart - activationStart));
      }

      // TBT — post-FCP portion of each long task beyond the 50ms threshold
      if (trackTBT) {
        tbtValue = 0;
        observe("longtask", (list) => {
          // Buffered long tasks can arrive before the paint observer fires
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
            tbtValue = (tbtValue ?? 0) + Math.max(0, taskEnd - taskStart - 50);
          }
        });
      }
    } catch {
      // noop — observability shouldn't crash the host page
    }
  }
}
