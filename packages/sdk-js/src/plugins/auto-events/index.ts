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

// Each stream is its own switch: `true`/`false` for the defaults, or an
// options object to tune it. Sampling rates never decide whether a stream
// exists (a payload-delivered rate may override them later).
type Stream<T> = boolean | (T & { enabled?: boolean });

export type CwvMetric = "FCP" | "LCP" | "INP" | "CLS" | "TTFB" | "TBT";

export type AutoEventsSettings = {
  // page_view / page_leave, plus optional page_engagement heartbeats
  standardEvents?: Stream<{
    samplingRate?: number;
    heartbeats?: boolean;
    heartbeatIntervalMs?: number;
    maxHeartbeats?: number;
    trackScrollDepth?: boolean;
  }>;
  // browser-error events from window.onerror / unhandledrejection
  errors?: Stream<{
    samplingRate?: number;
    debounceTimeout?: number;
  }>;
  // Core Web Vitals
  cwv?: Stream<{
    samplingRate?: number;
    metrics?: CwvMetric[];
  }>;
  // clicks, form submits, rage clicks
  clickstream?: Stream<{
    samplingRate?: number;
    clickSelector?: string;
    ignoreClickSelector?: string;
    collectElementText?: boolean;
    sensitiveSelector?: string;
    formSelector?: string;
    ignoreFormSelector?: string;
  }>;

  // Shared
  trackQueryStringChanges?: boolean; // treat ?query changes as new pages
  hashAttribute?: string;
  samplingSeed?: string; // change to rerandomize the cohort
};

type Resolved<T> = T & { enabled: boolean };

function resolveStream<T extends { samplingRate?: number }>(
  name: string,
  value: Stream<T> | undefined,
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

// Nothing ships at full volume unless explicitly configured
const DEFAULT_SAMPLING_RATE = 0.1;

export function autoEventsPlugin(settings: AutoEventsSettings = {}) {
  const standardEvents = resolveStream(
    "standardEvents",
    settings.standardEvents,
    {
      enabled: true,
      samplingRate: DEFAULT_SAMPLING_RATE,
      heartbeats: false,
    },
  );
  const errors = resolveStream("errors", settings.errors, {
    enabled: true,
    samplingRate: DEFAULT_SAMPLING_RATE,
  });
  const cwv = resolveStream("cwv", settings.cwv, {
    enabled: true,
    samplingRate: DEFAULT_SAMPLING_RATE,
  });
  const clickstream = resolveStream("clickstream", settings.clickstream, {
    enabled: false,
    samplingRate: DEFAULT_SAMPLING_RATE,
  });
  const {
    trackQueryStringChanges = false,
    hashAttribute = "id",
    samplingSeed = "gb-events",
  } = settings;
  const metrics = new Set<CwvMetric>(
    cwv.metrics ?? ["FCP", "LCP", "INP", "CLS", "TTFB", "TBT"],
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
      (cwv.enabled || standardEvents.enabled || clickstream.enabled)
    ) {
      console.warn(
        "autoEventsPlugin: CWV / standard events / clickstream need a GrowthBook instance, skipping",
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

    if (standardEvents.enabled && fullGB) {
      createEngagementReporter({
        samplingRate: standardEvents.samplingRate,
        heartbeats: standardEvents.heartbeats,
        heartbeatIntervalMs: standardEvents.heartbeatIntervalMs,
        maxHeartbeats: standardEvents.maxHeartbeats,
        trackScrollDepth: standardEvents.trackScrollDepth,
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
        ignoreClickSelector: clickstream.ignoreClickSelector,
        collectElementText: clickstream.collectElementText,
        sensitiveSelector: clickstream.sensitiveSelector,
        formSelector: clickstream.formSelector,
        ignoreFormSelector: clickstream.ignoreFormSelector,
        pageState,
        growthbook: gb,
      });
    }
  };
}
