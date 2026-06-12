import type { GrowthBook } from "../../GrowthBook";
import { detectEnv, shouldSample, syncGrowthBookUrl } from "./util";
import { subscribeToUrlChanges } from "./urlChangeObserver";
import {
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
  markPageLeaveSent,
  scheduleScrollUpdate,
} from "./pageState";

export type EngagementReporterSettings = {
  // page_view events (same as old pageViewReporter)
  pageViewSamplingRate?: number;
  // heartbeats + scroll + page_leave
  engagementSamplingRate?: number;
  hashAttribute?: string;
  pageViewSamplingSeed?: string;
  engagementSamplingSeed?: string;
  trackQueryStringChanges?: boolean;
  enableUrlPolling?: boolean;
  heartbeatIntervalMs?: number;
  maxHeartbeats?: number;
  trackScrollDepth?: boolean;
  growthbook: GrowthBook;
};

export function createEngagementReporter({
  pageViewSamplingRate = 0,
  engagementSamplingRate = 0,
  hashAttribute = "id",
  pageViewSamplingSeed,
  engagementSamplingSeed,
  trackQueryStringChanges = false,
  enableUrlPolling = false,
  heartbeatIntervalMs = 30000,
  maxHeartbeats = 3,
  trackScrollDepth = true,
  growthbook,
}: EngagementReporterSettings) {
  if (detectEnv() !== "browser") return;
  if (pageViewSamplingRate < 0 || pageViewSamplingRate > 1)
    throw new Error("pageViewSamplingRate must be between 0 and 1");
  if (engagementSamplingRate < 0 || engagementSamplingRate > 1)
    throw new Error("engagementSamplingRate must be between 0 and 1");

  const attrs = growthbook.getAttributes();
  const trackPageViews =
    pageViewSamplingRate > 0 &&
    shouldSample({
      rate: pageViewSamplingRate,
      hashAttribute,
      attributes: attrs,
      seed: pageViewSamplingSeed ?? "pageview-sampling",
    });
  const trackEngagement =
    engagementSamplingRate > 0 &&
    shouldSample({
      rate: engagementSamplingRate,
      hashAttribute,
      attributes: attrs,
      seed: engagementSamplingSeed ?? "engagement-sampling",
    });

  if (!trackPageViews && !trackEngagement) return;

  let stopped = false;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let unsubUrlChanges: (() => void) | null = null;

  const reportPageView = () => {
    if (stopped) return;
    syncGrowthBookUrl(growthbook);
    trackPageViews && growthbook.logEvent("page_view");
  };

  const sendPageLeave = (reason: string) => {
    if (!trackEngagement || stopped || isPageLeaveSent()) return;
    markPageLeaveSent();
    updateVisibleTime();
    growthbook.logEvent("page_leave", {
      leave_reason: reason,
      elapsed_time_ms: getElapsedTimeMs(),
      active_time_ms: getActiveTimeMs(),
      max_scroll_depth_percent: getMaxScrollDepthPercent(),
      click_count: getClickCount(),
      tracked_click_count: getTrackedClickCount(),
      form_submit_count: getFormSubmitCount(),
      engagement_heartbeat_count: getHeartbeatCount(),
      is_bounce_candidate:
        getTrackedClickCount() === 0 &&
        getFormSubmitCount() === 0 &&
        getActiveTimeMs() < 10000,
    });
  };

  const onUrlChange = () => {
    sendPageLeave("route_change");
    resetPageState();
    startHeartbeats();
    reportPageView();
  };

  const onPageShow = (event: PageTransitionEvent) => {
    if (!event.persisted) return;
    resetPageState();
    startHeartbeats();
    reportPageView();
  };

  const onPageHide = () => sendPageLeave("pagehide");

  const onVisibilityChange = () => {
    updateVisibleTime();
    if (!trackEngagement || stopped) return;
    if (document.visibilityState === "hidden") {
      growthbook.logEvent("page_engagement", {
        visibility_state: "hidden",
        elapsed_time_ms: getElapsedTimeMs(),
        active_time_ms: getActiveTimeMs(),
        max_scroll_depth_percent: getMaxScrollDepthPercent(),
      });
    }
  };

  const onScroll = () => trackScrollDepth && scheduleScrollUpdate();

  function startHeartbeats() {
    heartbeatTimer && clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    if (!trackEngagement) return;
    heartbeatTimer = setInterval(() => {
      if (stopped) return;
      if (document.visibilityState !== "visible") return;
      if (getHeartbeatCount() >= maxHeartbeats) {
        heartbeatTimer && clearInterval(heartbeatTimer);
        heartbeatTimer = null;
        return;
      }
      incrementHeartbeatCount();
      growthbook.logEvent("page_engagement", {
        heartbeat_index: getHeartbeatCount(),
        elapsed_time_ms: getElapsedTimeMs(),
        active_time_ms: getActiveTimeMs(),
        max_scroll_depth_percent: getMaxScrollDepthPercent(),
      });
    }, heartbeatIntervalMs);
  }

  // Wire up listeners
  window.addEventListener("pageshow", onPageShow);
  window.addEventListener("pagehide", onPageHide, { capture: true });
  document.addEventListener("visibilitychange", onVisibilityChange);
  if (trackScrollDepth) {
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  unsubUrlChanges = subscribeToUrlChanges(onUrlChange, {
    trackQueryString: trackQueryStringChanges,
    enablePolling: enableUrlPolling,
  });

  // Initial page view + heartbeats
  resetPageState();
  startHeartbeats();
  reportPageView();

  growthbook.onDestroy(() => {
    stopped = true;
    heartbeatTimer && clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    unsubUrlChanges?.();
    unsubUrlChanges = null;
    window.removeEventListener("pageshow", onPageShow);
    window.removeEventListener("pagehide", onPageHide, true);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    window.removeEventListener("scroll", onScroll);
  });
}
