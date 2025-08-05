import type { GrowthBook } from "../../GrowthBook";
import type {
  GrowthBookClient,
  UserScopedGrowthBook,
} from "../../GrowthBookClient";
import { createErrorReporter } from "./errorReporter";
import { createCWVReporter } from "./cwvReporter";
import { createPageViewReporter } from "./pageViewReporter";

type BrowserPerformanceSettings = {
  cwvSamplingRate?: number;
  errorSamplingRate?: number;
  pageViewSamplingRate?: number;
  hashAttribute?: string;
  trackFCP?: boolean;
  trackLCP?: boolean;
  trackFID?: boolean;
  trackCLS?: boolean;
  trackTTFB?: boolean;
  trackTBT?: boolean;
  debounceErrorTimeout?: number;
};

export function browserPerformancePlugin({
  cwvSamplingRate = 1,
  errorSamplingRate = 1,
  pageViewSamplingRate = 1,
  hashAttribute = "id",
  trackFCP = true,
  trackLCP = true,
  trackFID = true,
  trackCLS = true,
  trackTTFB = true,
  trackTBT = true,
  debounceErrorTimeout = 100,
}: BrowserPerformanceSettings = {}) {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("browserPerformancePlugin only works in the browser");
  }

  return (gb: GrowthBook | UserScopedGrowthBook | GrowthBookClient) => {
    if (!gb.logEvent) {
      throw new Error("GrowthBook instance must have a logEvent method");
    }

    if (cwvSamplingRate > 0) {
      createCWVReporter({
        trackFCP,
        trackLCP,
        trackFID,
        trackCLS,
        trackTTFB,
        trackTBT,
        samplingRate: cwvSamplingRate,
        hashAttribute,
        growthbook: gb,
      });
    }

    if (errorSamplingRate > 0) {
      createErrorReporter({
        debounceTimeout: debounceErrorTimeout,
        samplingRate: errorSamplingRate,
        hashAttribute,
        growthbook: gb,
      });
    }

    if (pageViewSamplingRate > 0) {
      createPageViewReporter({
        samplingRate: pageViewSamplingRate,
        hashAttribute,
        growthbook: gb,
      });
    }
  };
}
