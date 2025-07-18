import type { GrowthBook } from "../../GrowthBook";
import { createErrorReporter } from "./errorReporter";
import { createCWVReporter } from "./cwvReporter";

type BrowserPerformanceSettings = {
  samplingRate?: number;
  errorSamplingRate?: number;
  hashAttribute?: string;
  trackCWV?: boolean;
  trackFCP?: boolean;
  trackLCP?: boolean;
  trackFID?: boolean;
  trackCLS?: boolean;
  trackTTFB?: boolean;
  trackTBT?: boolean;
  trackErrors?: boolean;
  debounceErrorTimeout?: number;
};

export function browserPerformancePlugin({
  samplingRate = 0.1,
  errorSamplingRate,
  hashAttribute = "id",
  trackCWV = true,
  trackFCP = true,
  trackLCP = true,
  trackFID = true,
  trackCLS = true,
  trackTTFB = true,
  trackTBT = true,
  trackErrors = true,
  debounceErrorTimeout = 100,
}: BrowserPerformanceSettings = {}) {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("browserPerformancePlugin only works in the browser");
  }

  return (gb: GrowthBook) => {
    if (!gb.logEvent) {
      throw new Error("GrowthBook instance must have a logEvent method");
    }

    if (trackCWV) {
      createCWVReporter({
        trackFCP,
        trackLCP,
        trackFID,
        trackCLS,
        trackTTFB,
        trackTBT,
        samplingRate: errorSamplingRate ?? samplingRate,
        hashAttribute,
        growthbook: gb,
      });
    }

    if (trackErrors) {
      createErrorReporter({
        logEvent: gb.logEvent,
        debounceTimeout: debounceErrorTimeout,
        samplingRate: errorSamplingRate ?? samplingRate,
        hashAttribute,
        growthbook: gb,
      });
    }
  };
}
