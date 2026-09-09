import type { GrowthBook } from "../../GrowthBook";
import { DEFAULT_SAMPLING_SEED, shouldSample } from "../utils/sampling";
import { currentPageUrl, detectEnv, whenActivated } from "../utils/browser";
import { subscribeToUrlChanges } from "../utils/url-change-observer";
import { createPageState, type PageState } from "./page-state";

const noop = () => {};

export type EngagementReporterSettings = {
  samplingRate?: number;
  // page_engagement heartbeats + hidden-tab events; page_view/page_leave are
  // always emitted for sampled users
  heartbeats?: boolean;
  heartbeatIntervalMs?: number;
  maxHeartbeats?: number;
  trackScrollDepth?: boolean;
  trackQueryStringChanges?: boolean;
  hashAttribute?: string;
  samplingSeed?: string;
  // Shared with the interaction reporter of the same instance
  pageState?: PageState;
  growthbook: GrowthBook;
};

export function createEngagementReporter({
  samplingRate = 1,
  heartbeats = false,
  heartbeatIntervalMs = 30000,
  maxHeartbeats = 3,
  trackScrollDepth = true,
  trackQueryStringChanges = false,
  hashAttribute = "id",
  samplingSeed = DEFAULT_SAMPLING_SEED,
  pageState,
  growthbook,
}: EngagementReporterSettings): () => void {
  if (detectEnv() !== "browser") return noop;
  if (
    !shouldSample({
      rate: Math.min(1, Math.max(0, samplingRate)),
      hashAttribute,
      attributes: growthbook.getAttributes(),
      seed: samplingSeed,
    })
  ) {
    return noop;
  }

  const {
    resetPageState,
    updateVisibleTime,
    getActiveTimeMs,
    getElapsedTimeMs,
    getMaxScrollDepthPercent,
    getClickCount,
    getTrackedClickCount,
    getFormSubmitCount,
    getHeartbeatCount,
    incrementHeartbeatCount,
    isPageLeaveSent,
    isInteractionTrackingActive,
    markPageLeaveSent,
    scheduleScrollUpdate,
    updateScrollDepth,
  } = pageState ?? createPageState();

  let stopped = false;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let unsubUrlChanges: (() => void) | null = null;
  // Tab-switch churn shouldn't emit unbounded events
  const MAX_HIDDEN_EVENTS = 10;
  let hiddenEvents = 0;
  // Attributed explicitly — mutating the SDK URL would re-run auto experiments
  let pageUrl = currentPageUrl();

  const startPage = () => {
    resetPageState();
    hiddenEvents = 0;
    pageUrl = currentPageUrl();
    trackScrollDepth && updateScrollDepth();
    startHeartbeats();
    if (stopped) return;
    growthbook.logEvent("page_view", {}, { url: pageUrl });
  };

  const sendPageLeave = (reason: string) => {
    if (stopped || isPageLeaveSent()) return;
    markPageLeaveSent();
    updateVisibleTime();
    trackScrollDepth && updateScrollDepth();
    growthbook.logEvent(
      "page_leave",
      {
        leave_reason: reason,
        elapsed_time_ms: getElapsedTimeMs(),
        active_time_ms: getActiveTimeMs(),
        max_scroll_depth_percent: getMaxScrollDepthPercent(),
        engagement_heartbeat_count: getHeartbeatCount(),
        // Only the interaction reporter increments these; omit rather than
        // report a misleading 0
        ...(isInteractionTrackingActive() && {
          click_count: getClickCount(),
          tracked_click_count: getTrackedClickCount(),
          form_submit_count: getFormSubmitCount(),
          is_bounce_candidate:
            getTrackedClickCount() === 0 &&
            getFormSubmitCount() === 0 &&
            getActiveTimeMs() < 10000,
        }),
      },
      { url: pageUrl },
    );
  };

  const onUrlChange = () => {
    sendPageLeave("route_change");
    startPage();
  };

  const onPageShow = (event: PageTransitionEvent) => {
    if (!event.persisted) return;
    startPage();
  };

  const onPageHide = () => sendPageLeave("pagehide");

  const onVisibilityChange = () => {
    updateVisibleTime();
    if (!heartbeats || stopped) return;
    if (document.visibilityState === "hidden") {
      if (hiddenEvents >= MAX_HIDDEN_EVENTS) return;
      hiddenEvents++;
      growthbook.logEvent(
        "page_engagement",
        {
          visibility_state: "hidden",
          elapsed_time_ms: getElapsedTimeMs(),
          active_time_ms: getActiveTimeMs(),
          max_scroll_depth_percent: getMaxScrollDepthPercent(),
        },
        { url: pageUrl },
      );
    }
  };

  const onScroll = () => trackScrollDepth && scheduleScrollUpdate();

  function startHeartbeats() {
    heartbeatTimer && clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    if (!heartbeats) return;
    heartbeatTimer = setInterval(() => {
      if (stopped) return;
      if (document.visibilityState !== "visible") return;
      if (getHeartbeatCount() >= maxHeartbeats) {
        heartbeatTimer && clearInterval(heartbeatTimer);
        heartbeatTimer = null;
        return;
      }
      incrementHeartbeatCount();
      growthbook.logEvent(
        "page_engagement",
        {
          heartbeat_index: getHeartbeatCount(),
          elapsed_time_ms: getElapsedTimeMs(),
          active_time_ms: getActiveTimeMs(),
          max_scroll_depth_percent: getMaxScrollDepthPercent(),
        },
        { url: pageUrl },
      );
    }, heartbeatIntervalMs);
  }

  window.addEventListener("pageshow", onPageShow);
  window.addEventListener("pagehide", onPageHide, { capture: true });
  document.addEventListener("visibilitychange", onVisibilityChange);
  if (trackScrollDepth) {
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  unsubUrlChanges = subscribeToUrlChanges(onUrlChange, {
    trackQueryString: trackQueryStringChanges,
  });

  whenActivated(startPage);

  const stop = () => {
    stopped = true;
    heartbeatTimer && clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    unsubUrlChanges && unsubUrlChanges();
    unsubUrlChanges = null;
    window.removeEventListener("pageshow", onPageShow);
    window.removeEventListener("pagehide", onPageHide, true);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    window.removeEventListener("scroll", onScroll);
  };
  growthbook.onDestroy(stop);
  return stop;
}
