// Per-page-view mutable state. Reset on SPA navigation by engagement reporter;
// counters incremented by interaction reporter.

// The plugins barrel is imported server-side too
const now = () =>
  typeof performance !== "undefined" ? performance.now() : Date.now();

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

export function resetPageState() {
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

export function updateVisibleTime() {
  const t = now();
  if (visibleSince != null) {
    activeTimeMs += t - visibleSince;
    visibleSince = document.visibilityState === "visible" ? t : null;
  } else if (document.visibilityState === "visible") {
    visibleSince = t;
  }
}

export function getActiveTimeMs(): number {
  let t = activeTimeMs;
  if (visibleSince != null) t += now() - visibleSince;
  return Math.round(t);
}

export function getElapsedTimeMs(): number {
  return Math.round(now() - startTime);
}

export function getScrollDepthPercent(): number {
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

export function updateScrollDepth() {
  maxScrollDepthPercent = Math.max(
    maxScrollDepthPercent,
    getScrollDepthPercent(),
  );
}

export function scheduleScrollUpdate() {
  if (scrollScheduled) return;
  scrollScheduled = true;
  requestAnimationFrame(() => {
    scrollScheduled = false;
    updateScrollDepth();
  });
}

export function getClickCount() {
  return clickCount;
}
export function getTrackedClickCount() {
  return trackedClickCount;
}
export function getRageClickCount() {
  return rageClickCount;
}
export function getFormSubmitCount() {
  return formSubmitCount;
}
export function getHeartbeatCount() {
  return heartbeatCount;
}
export function getMaxScrollDepthPercent() {
  return maxScrollDepthPercent;
}
export function isPageLeaveSent() {
  return pageLeaveSent;
}

export function incrementClickCount() {
  clickCount++;
}
export function incrementTrackedClickCount() {
  trackedClickCount++;
}
export function incrementRageClickCount() {
  rageClickCount++;
}
export function incrementFormSubmitCount() {
  formSubmitCount++;
}
export function incrementHeartbeatCount() {
  heartbeatCount++;
}
export function markPageLeaveSent() {
  pageLeaveSent = true;
}
export function markInteractionTrackingActive() {
  interactionTrackingActive = true;
}
export function isInteractionTrackingActive() {
  return interactionTrackingActive;
}

export function _resetPageStateForTests() {
  resetPageState();
  interactionTrackingActive = false;
}
