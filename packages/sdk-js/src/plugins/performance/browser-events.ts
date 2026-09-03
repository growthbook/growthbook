import type { GrowthBook } from "../../GrowthBook";
import type {
  GrowthBookClient,
  UserScopedGrowthBook,
} from "../../GrowthBookClient";
import { createCWVReporter } from "./cwvReporter";
import { createErrorReporter } from "./errorReporter";
import { createEngagementReporter } from "./engagementReporter";
import { createInteractionReporter } from "./interactionReporter";

function isFullGrowthBook(
  gb: GrowthBook | UserScopedGrowthBook | GrowthBookClient,
): gb is GrowthBook {
  return "getAttributes" in gb && "onDestroy" in gb && "setURL" in gb;
}

export type BrowserEventsSettings = {
  // Core web vitals (browser performance)
  cwvSamplingRate?: number;
  trackFCP?: boolean;
  trackLCP?: boolean;
  trackFID?: boolean; // deprecated, off by default
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
  enableUrlPolling?: boolean; // setInterval fallback for URL change detection

  // Errors
  errorSamplingRate?: number;
  debounceErrorTimeout?: number;

  // User interactions
  interactionSamplingRate?: number;
  clickSelector?: string;
  ignoreClickSelector?: string;
  collectElementText?: boolean;
  sensitiveSelector?: string;
  rageThreshold?: number;
  rageTimeWindowMs?: number;
  rageMaxDistancePx?: number;
  formSelector?: string;
  ignoreFormSelector?: string;

  // Global settings
  hashAttribute?: string;
  samplingSeed?: string; // change to rerandomize the cohort
  independentSampling?: boolean; // true = per-reporter seeds; false = same user in/out of all
};

export function browserEventsPlugin({
  // Core web vitals
  cwvSamplingRate = 1,
  trackFCP = true,
  trackLCP = true,
  trackFID = false,
  trackINP = true,
  trackCLS = true,
  trackTTFB = true,
  trackTBT = true,
  // Page views + engagement
  pageViewSamplingRate = 1,
  engagementSamplingRate = 0,
  heartbeatIntervalMs = 30000,
  maxHeartbeats = 3,
  trackScrollDepth = true,
  // CWV + page views shared settings
  trackQueryStringChanges = false,
  enableUrlPolling = false,
  // Errors
  errorSamplingRate = 1,
  debounceErrorTimeout = 100,
  // User interactions
  interactionSamplingRate = 0,
  clickSelector,
  ignoreClickSelector,
  collectElementText,
  sensitiveSelector,
  rageThreshold,
  rageTimeWindowMs,
  rageMaxDistancePx,
  formSelector,
  ignoreFormSelector,
  // Global settings
  hashAttribute = "id",
  samplingSeed = "gb-events",
  independentSampling = false,
}: BrowserEventsSettings = {}) {
  return (gb: GrowthBook | UserScopedGrowthBook | GrowthBookClient) => {
    if (typeof window === "undefined" || typeof document === "undefined")
      return;

    if (!gb.logEvent) {
      throw new Error("GrowthBook instance must have a logEvent method");
    }

    const fullGB = isFullGrowthBook(gb);
    const seed = (id: string) =>
      samplingSeed + (independentSampling ? ":" + id : "");

    if (!fullGB) {
      const needsFullGB =
        cwvSamplingRate > 0 ||
        pageViewSamplingRate > 0 ||
        engagementSamplingRate > 0 ||
        interactionSamplingRate > 0;
      needsFullGB &&
        console.warn(
          "browserEventsPlugin: CWV / engagement / interaction need a GrowthBook instance, skipping",
        );
    }

    if (cwvSamplingRate > 0 && fullGB) {
      createCWVReporter({
        trackFCP,
        trackLCP,
        trackFID,
        trackINP,
        trackCLS,
        trackTTFB,
        trackTBT,
        samplingRate: cwvSamplingRate,
        hashAttribute,
        samplingSeed: seed("cwv"),
        trackQueryStringChanges,
        enableUrlPolling,
        growthbook: gb,
      });
    }

    if (errorSamplingRate > 0) {
      createErrorReporter({
        debounceTimeout: debounceErrorTimeout,
        samplingRate: errorSamplingRate,
        hashAttribute,
        samplingSeed: seed("error"),
        growthbook: gb,
      });
    }

    if ((pageViewSamplingRate > 0 || engagementSamplingRate > 0) && fullGB) {
      createEngagementReporter({
        pageViewSamplingRate,
        engagementSamplingRate,
        hashAttribute,
        pageViewSamplingSeed: seed("pageview"),
        engagementSamplingSeed: seed("engagement"),
        trackQueryStringChanges,
        enableUrlPolling,
        heartbeatIntervalMs,
        maxHeartbeats,
        trackScrollDepth,
        growthbook: gb,
      });
    }

    if (interactionSamplingRate > 0 && fullGB) {
      createInteractionReporter({
        samplingRate: interactionSamplingRate,
        hashAttribute,
        samplingSeed: seed("interaction"),
        clickSelector,
        ignoreClickSelector,
        collectElementText,
        sensitiveSelector,
        rageThreshold,
        rageTimeWindowMs,
        rageMaxDistancePx,
        formSelector,
        ignoreFormSelector,
        growthbook: gb,
      });
    }
  };
}
