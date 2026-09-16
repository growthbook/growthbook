import type { GrowthBook } from "../../GrowthBook";
import {
  currentPageUrl,
  detectEnv,
  shouldSample,
  whenActivated,
} from "../util";
import { subscribeToUrlChanges } from "../util/urlChangeObserver";
import { createPageState, type PageState } from "./pageState";

export type EngagementReporterSettings = {
  // page_view events
  trackPageViews?: boolean;
  pageViewSamplingRate?: number;
  // heartbeats + scroll + page_leave
  trackEngagement?: boolean;
  engagementSamplingRate?: number;
  hashAttribute?: string;
  samplingSeed?: string;
  trackQueryStringChanges?: boolean;
  heartbeatIntervalMs?: number;
  maxHeartbeats?: number;
  trackScrollDepth?: boolean;
  // Shared with the interaction reporter of the same instance
  pageState?: PageState;
  growthbook: GrowthBook;
};

export function createEngagementReporter({
  trackPageViews: pageViewsEnabled = true,
  pageViewSamplingRate = 0,
  trackEngagement: engagementEnabled = true,
  engagementSamplingRate = 0,
  hashAttribute = "id",
  samplingSeed = "engagement",
  trackQueryStringChanges = false,
  heartbeatIntervalMs = 30000,
  maxHeartbeats = 3,
  trackScrollDepth = true,
  pageState,
  growthbook,
}: EngagementReporterSettings) {
  if (detectEnv() !== "browser") return;
  pageViewSamplingRate = Math.min(1, Math.max(0, pageViewSamplingRate));
  engagementSamplingRate = Math.min(1, Math.max(0, engagementSamplingRate));

  const attrs = growthbook.getAttributes();
  const trackPageViews =
    pageViewsEnabled &&
    shouldSample({
      rate: pageViewSamplingRate,
      hashAttribute,
      attributes: attrs,
      seed: samplingSeed,
    });
  const trackEngagement =
    engagementEnabled &&
    shouldSample({
      rate: engagementSamplingRate,
      hashAttribute,
      attributes: attrs,
      seed: samplingSeed,
    });

  if (!trackPageViews && !trackEngagement) return;

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
  // Events are attributed to their page explicitly rather than by mutating
  // the SDK's URL, which would re-run auto experiments for sampled users only
  let pageUrl = currentPageUrl();

  const startPage = () => {
    resetPageState();
    hiddenEvents = 0;
    pageUrl = currentPageUrl();
    trackScrollDepth && updateScrollDepth();
    startHeartbeats();
    if (stopped) return;
    trackPageViews && growthbook.logEvent("page_view", {}, { url: pageUrl });
  };

  const sendPageLeave = (reason: string) => {
    if (!trackEngagement || stopped || isPageLeaveSent()) return;
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
    if (!trackEngagement || stopped) return;
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

  // Wire up listeners
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
