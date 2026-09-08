import type { GrowthBook } from "../../GrowthBook";
import type {
  GrowthBookClient,
  UserScopedGrowthBook,
} from "../../GrowthBookClient";
import { normalizeSamplingRate } from "../utils/sampling";
import { createCWVReporter } from "./cwvReporter";
import { createErrorReporter } from "./errorReporter";
import { createEngagementReporter } from "./engagementReporter";
import { createInteractionReporter } from "./interactionReporter";
import { createPageState } from "./pageState";

function isFullGrowthBook(
  gb: GrowthBook | UserScopedGrowthBook | GrowthBookClient,
): gb is GrowthBook {
  return "getAttributes" in gb && "onDestroy" in gb && "setURL" in gb;
}

export type AutoEventsSettings = {
  // Which streams exist. Sampling rates only decide how much of each is kept.
  trackCWV?: boolean;
  trackErrors?: boolean;
  trackPageViews?: boolean;
  trackEngagement?: boolean;
  trackInteractions?: boolean;

  // Core web vitals (browser performance)
  cwvSamplingRate?: number;
  trackFCP?: boolean;
  trackLCP?: boolean;
  trackINP?: boolean;
  trackCLS?: boolean;
  trackTTFB?: boolean;
  trackTBT?: boolean;

  // Page views + engagement
  pageViewSamplingRate?: number;
  engagementSamplingRate?: number;
  heartbeatIntervalMs?: number;
  maxHeartbeats?: number;
  trackScrollDepth?: boolean;

  // CWV + page views shared settings
  trackQueryStringChanges?: boolean; // treat ?query changes as new pages

  // Errors
  errorSamplingRate?: number;
  debounceErrorTimeout?: number;

  // User interactions
  interactionSamplingRate?: number;
  clickSelector?: string;
  ignoreClickSelector?: string;
  collectElementText?: boolean;
  sensitiveSelector?: string;
  formSelector?: string;
  ignoreFormSelector?: string;

  // Global settings
  hashAttribute?: string;
  samplingSeed?: string; // change to rerandomize the cohort
};

// Nothing ships at full volume unless explicitly configured
const DEFAULT_SAMPLING_RATE = 0.1;

export function autoEventsPlugin({
  trackCWV = true,
  trackErrors = true,
  trackPageViews = true,
  trackEngagement = false,
  trackInteractions = false,
  // Core web vitals
  cwvSamplingRate = DEFAULT_SAMPLING_RATE,
  trackFCP = true,
  trackLCP = true,
  trackINP = true,
  trackCLS = true,
  trackTTFB = true,
  trackTBT = true,
  // Page views + engagement
  pageViewSamplingRate = DEFAULT_SAMPLING_RATE,
  engagementSamplingRate = 0,
  heartbeatIntervalMs = 30000,
  maxHeartbeats = 3,
  trackScrollDepth = true,
  // CWV + page views shared settings
  trackQueryStringChanges = false,
  // Errors
  errorSamplingRate = DEFAULT_SAMPLING_RATE,
  debounceErrorTimeout = 100,
  // User interactions
  interactionSamplingRate = 0,
  clickSelector,
  ignoreClickSelector,
  collectElementText,
  sensitiveSelector,
  formSelector,
  ignoreFormSelector,
  // Global settings
  hashAttribute = "id",
  samplingSeed = "gb-events",
}: AutoEventsSettings = {}) {
  cwvSamplingRate = normalizeSamplingRate(
    cwvSamplingRate,
    DEFAULT_SAMPLING_RATE,
    "cwvSamplingRate",
  );
  pageViewSamplingRate = normalizeSamplingRate(
    pageViewSamplingRate,
    DEFAULT_SAMPLING_RATE,
    "pageViewSamplingRate",
  );
  engagementSamplingRate = normalizeSamplingRate(
    engagementSamplingRate,
    0,
    "engagementSamplingRate",
  );
  errorSamplingRate = normalizeSamplingRate(
    errorSamplingRate,
    DEFAULT_SAMPLING_RATE,
    "errorSamplingRate",
  );
  interactionSamplingRate = normalizeSamplingRate(
    interactionSamplingRate,
    0,
    "interactionSamplingRate",
  );

  return (gb: GrowthBook | UserScopedGrowthBook | GrowthBookClient) => {
    if (typeof window === "undefined" || typeof document === "undefined")
      return;

    if (!gb.logEvent) {
      throw new Error("GrowthBook instance must have a logEvent method");
    }

    const fullGB = isFullGrowthBook(gb);
    const pageState = createPageState();

    if (
      !fullGB &&
      (trackCWV || trackPageViews || trackEngagement || trackInteractions)
    ) {
      console.warn(
        "autoEventsPlugin: CWV / engagement / interaction need a GrowthBook instance, skipping",
      );
    }

    if (trackCWV && fullGB) {
      createCWVReporter({
        trackFCP,
        trackLCP,
        trackINP,
        trackCLS,
        trackTTFB,
        trackTBT,
        samplingRate: cwvSamplingRate,
        hashAttribute,
        samplingSeed,
        trackQueryStringChanges,
        growthbook: gb,
      });
    }

    if (trackErrors) {
      createErrorReporter({
        debounceTimeout: debounceErrorTimeout,
        samplingRate: errorSamplingRate,
        hashAttribute,
        samplingSeed,
        growthbook: gb,
      });
    }

    if ((trackPageViews || trackEngagement) && fullGB) {
      createEngagementReporter({
        trackPageViews,
        trackEngagement,
        pageViewSamplingRate,
        engagementSamplingRate,
        hashAttribute,
        samplingSeed,
        trackQueryStringChanges,
        heartbeatIntervalMs,
        maxHeartbeats,
        trackScrollDepth,
        pageState,
        growthbook: gb,
      });
    }

    if (trackInteractions && fullGB) {
      createInteractionReporter({
        samplingRate: interactionSamplingRate,
        hashAttribute,
        samplingSeed,
        clickSelector,
        ignoreClickSelector,
        collectElementText,
        sensitiveSelector,
        formSelector,
        ignoreFormSelector,
        pageState,
        growthbook: gb,
      });
    }
  };
}
