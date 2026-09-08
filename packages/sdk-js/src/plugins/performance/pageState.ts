// Per-page-view mutable state. Reset on SPA navigation by engagement reporter;
// counters incremented by interaction reporter.

// The plugins barrel is imported server-side too
const now = () =>
  typeof performance !== "undefined" ? performance.now() : Date.now();

export type PageState = ReturnType<typeof createPageState>;

// Per-page-view state shared by the engagement and interaction reporters of
// one GrowthBook instance
export function createPageState() {
  let startTime = now();
  let visibleSince: number | null =
    typeof document !== "undefined" && document.visibilityState === "visible"
      ? now()
      : null;
  let activeTimeMs = 0;
  let maxScrollDepthPercent = 0;
  let scrollScheduled = false;
  let pageLeaveSent = false;

  let clickCount = 0;
  let trackedClickCount = 0;
  let rageClickCount = 0;
  let formSubmitCount = 0;
  let heartbeatCount = 0;
  let interactionTrackingActive = false;

  function resetPageState() {
    startTime = now();
    visibleSince = document.visibilityState === "visible" ? now() : null;
    activeTimeMs = 0;
    maxScrollDepthPercent = 0;
    scrollScheduled = false;
    pageLeaveSent = false;
    clickCount = 0;
    trackedClickCount = 0;
    rageClickCount = 0;
    formSubmitCount = 0;
    heartbeatCount = 0;
  }

  function updateVisibleTime() {
    const t = now();
    if (visibleSince != null) {
      activeTimeMs += t - visibleSince;
      visibleSince = document.visibilityState === "visible" ? t : null;
    } else if (document.visibilityState === "visible") {
      visibleSince = t;
    }
  }

  function getActiveTimeMs(): number {
    let t = activeTimeMs;
    if (visibleSince != null) t += now() - visibleSince;
    return Math.round(t);
  }

  function getElapsedTimeMs(): number {
    return Math.round(now() - startTime);
  }

  function getScrollDepthPercent(): number {
    const doc = document.documentElement;
    const body = document.body;
    const scrollTop = window.scrollY || doc.scrollTop || body.scrollTop || 0;
    const scrollHeight = Math.max(
      body.scrollHeight,
      doc.scrollHeight,
      body.offsetHeight,
      doc.offsetHeight,
      body.clientHeight,
      doc.clientHeight,
    );
    const viewportHeight = window.innerHeight || doc.clientHeight;
    if (scrollHeight <= viewportHeight) return 100;
    return Math.min(
      100,
      Math.round(((scrollTop + viewportHeight) / scrollHeight) * 100),
    );
  }

  function updateScrollDepth() {
    maxScrollDepthPercent = Math.max(
      maxScrollDepthPercent,
      getScrollDepthPercent(),
    );
  }

  function scheduleScrollUpdate() {
    if (scrollScheduled) return;
    scrollScheduled = true;
    requestAnimationFrame(() => {
      scrollScheduled = false;
      updateScrollDepth();
    });
  }

  function getClickCount() {
    return clickCount;
  }
  function getTrackedClickCount() {
    return trackedClickCount;
  }
  function getRageClickCount() {
    return rageClickCount;
  }
  function getFormSubmitCount() {
    return formSubmitCount;
  }
  function getHeartbeatCount() {
    return heartbeatCount;
  }
  function getMaxScrollDepthPercent() {
    return maxScrollDepthPercent;
  }
  function isPageLeaveSent() {
    return pageLeaveSent;
  }

  function incrementClickCount() {
    clickCount++;
  }
  function incrementTrackedClickCount() {
    trackedClickCount++;
  }
  function incrementRageClickCount() {
    rageClickCount++;
  }
  function incrementFormSubmitCount() {
    formSubmitCount++;
  }
  function incrementHeartbeatCount() {
    heartbeatCount++;
  }
  function markPageLeaveSent() {
    pageLeaveSent = true;
  }
  function markInteractionTrackingActive() {
    interactionTrackingActive = true;
  }
  function markInteractionTrackingInactive() {
    interactionTrackingActive = false;
  }
  function isInteractionTrackingActive() {
    return interactionTrackingActive;
  }

  return {
    resetPageState,
    updateVisibleTime,
    getActiveTimeMs,
    getElapsedTimeMs,
    getScrollDepthPercent,
    updateScrollDepth,
    scheduleScrollUpdate,
    getClickCount,
    getTrackedClickCount,
    getRageClickCount,
    getFormSubmitCount,
    getHeartbeatCount,
    getMaxScrollDepthPercent,
    isPageLeaveSent,
    incrementClickCount,
    incrementTrackedClickCount,
    incrementRageClickCount,
    incrementFormSubmitCount,
    incrementHeartbeatCount,
    markPageLeaveSent,
    markInteractionTrackingActive,
    markInteractionTrackingInactive,
    isInteractionTrackingActive,
  };
}
