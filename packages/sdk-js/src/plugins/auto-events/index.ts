import {
  DEFAULT_SAMPLING_SEED,
  normalizeSamplingRate,
} from "../utils/sampling";
import { isFullGrowthBook, type AnyGrowthBook } from "../utils/instance";
import { sharePrivacySettings, type PrivacySettings } from "../utils/privacy";
import { createCWVReporter } from "./cwv-reporter";
import { createErrorReporter } from "./error-reporter";
import { createEngagementReporter } from "./engagement-reporter";
import { createInteractionReporter } from "./interaction-reporter";
import { createPageState } from "./page-state";

// `true`/`false` for the defaults, or an options object to tune a category
type Toggle<T> = boolean | (T & { enabled?: boolean });

export type CwvMetric = "FCP" | "LCP" | "INP" | "CLS" | "TTFB" | "TBT";

export type AutoEventsSettings = {
  // page_view / page_leave, plus optional page_engagement heartbeats
  pageEvents?: Toggle<{
    samplingRate?: number;
    heartbeats?: boolean;
    heartbeatIntervalMs?: number;
    maxHeartbeats?: number;
    trackScrollDepth?: boolean;
  }>;
  // browser-error events from window.onerror / unhandledrejection
  errors?: Toggle<{
    samplingRate?: number;
    debounceTimeout?: number;
  }>;
  // Core Web Vitals
  cwv?: Toggle<{
    samplingRate?: number;
    metrics?: CwvMetric[];
  }>;
  // clicks, form submits, rage clicks
  clickstream?: Toggle<{
    samplingRate?: number;
    clickSelector?: string;
    collectElementText?: boolean;
    formSelector?: string;
  }>;

  // Shared across categories
  privacy?: PrivacySettings; // also inherited by other plugins
  trackQueryStringChanges?: boolean; // treat ?query changes as new pages
  hashAttribute?: string;
  samplingSeed?: string; // change to rerandomize the cohort
};

// Nothing ships at full volume unless explicitly configured
const DEFAULT_SAMPLING_RATE = 0.1;

type Resolved<T> = T & { enabled: boolean };

function resolveCategory<T extends { samplingRate?: number }>(
  name: string,
  value: Toggle<T> | undefined,
  defaults: Resolved<T>,
): Resolved<T> {
  const resolved: Resolved<T> =
    value === undefined
      ? defaults
      : typeof value === "boolean"
        ? { ...defaults, enabled: value }
        : { ...defaults, ...value, enabled: value.enabled ?? true };
  resolved.samplingRate = normalizeSamplingRate(
    resolved.samplingRate,
    defaults.samplingRate ?? DEFAULT_SAMPLING_RATE,
    `${name}.samplingRate`,
  );
  return resolved;
}

export function autoEventsPlugin(settings: AutoEventsSettings = {}) {
  const pageEvents = resolveCategory("pageEvents", settings.pageEvents, {
    enabled: true,
    samplingRate: DEFAULT_SAMPLING_RATE,
    heartbeats: false,
  });
  const errors = resolveCategory("errors", settings.errors, {
    enabled: true,
    samplingRate: DEFAULT_SAMPLING_RATE,
  });
  const cwv = resolveCategory("cwv", settings.cwv, {
    enabled: true,
    samplingRate: DEFAULT_SAMPLING_RATE,
  });
  const clickstream = resolveCategory("clickstream", settings.clickstream, {
    enabled: false,
    samplingRate: DEFAULT_SAMPLING_RATE,
  });
  const {
    privacy,
    trackQueryStringChanges = false,
    hashAttribute = "id",
    samplingSeed = DEFAULT_SAMPLING_SEED,
  } = settings;
  sharePrivacySettings(privacy);
  const metrics = new Set<CwvMetric>(
    cwv.metrics ?? ["FCP", "LCP", "INP", "CLS", "TTFB", "TBT"],
  );

  return (gb: AnyGrowthBook) => {
    if (typeof window === "undefined" || typeof document === "undefined")
      return;

    const fullGB = isFullGrowthBook(gb);
    const pageState = createPageState();

    if (!fullGB && (cwv.enabled || pageEvents.enabled || clickstream.enabled)) {
      console.warn(
        "autoEventsPlugin: CWV / page events / clickstream need a GrowthBook instance, skipping",
      );
    }

    if (cwv.enabled && fullGB) {
      createCWVReporter({
        trackFCP: metrics.has("FCP"),
        trackLCP: metrics.has("LCP"),
        trackINP: metrics.has("INP"),
        trackCLS: metrics.has("CLS"),
        trackTTFB: metrics.has("TTFB"),
        trackTBT: metrics.has("TBT"),
        samplingRate: cwv.samplingRate,
        hashAttribute,
        samplingSeed,
        trackQueryStringChanges,
        growthbook: gb,
      });
    }

    if (errors.enabled) {
      createErrorReporter({
        debounceTimeout: errors.debounceTimeout,
        samplingRate: errors.samplingRate,
        hashAttribute,
        samplingSeed,
        growthbook: gb,
      });
    }

    if (pageEvents.enabled && fullGB) {
      createEngagementReporter({
        samplingRate: pageEvents.samplingRate,
        heartbeats: pageEvents.heartbeats,
        heartbeatIntervalMs: pageEvents.heartbeatIntervalMs,
        maxHeartbeats: pageEvents.maxHeartbeats,
        trackScrollDepth: pageEvents.trackScrollDepth,
        hashAttribute,
        samplingSeed,
        trackQueryStringChanges,
        pageState,
        growthbook: gb,
      });
    }

    if (clickstream.enabled && fullGB) {
      createInteractionReporter({
        samplingRate: clickstream.samplingRate,
        hashAttribute,
        samplingSeed,
        clickSelector: clickstream.clickSelector,
        collectElementText: clickstream.collectElementText,
        formSelector: clickstream.formSelector,
        privacy,
        pageState,
        growthbook: gb,
      });
    }
  };
}
