/**
 * Automatic browser events: page views and engagement, browser errors, Core
 * Web Vitals, and clickstream. Every category is off until local settings
 * or remote sdkSettings turn it on. Browser only; inert on the server, so
 * it is safe in a plugins array shared with SSR.
 */
import type { GrowthBook } from "../../GrowthBook";
import type {
  AutoEventCategorySettings,
  AutoEventsRemoteSettings,
} from "../../types/growthbook";
import {
  DEFAULT_SAMPLING_SEED,
  normalizeSamplingRate,
} from "../utils/sampling";
import { mergeSettings } from "../utils/settings";
import { sharePrivacySettings, type PrivacySettings } from "../utils/privacy";
import { isFullGrowthBook, type AnyGrowthBook } from "../utils/instance";
import { createCWVReporter } from "./cwv-reporter";
import { createErrorReporter } from "./error-reporter";
import { createEngagementReporter } from "./engagement-reporter";
import { createInteractionReporter } from "./interaction-reporter";
import { createPageState } from "./page-state";

// `true`/`false` for the defaults, or an options object to tune a category
type Toggle<T> = boolean | (T & { enabled?: boolean });

export type CwvMetric = "FCP" | "LCP" | "INP" | "CLS" | "TTFB" | "TBT";

type PageEventsOptions = {
  samplingRate?: number;
  heartbeats?: boolean;
  heartbeatIntervalMs?: number;
  maxHeartbeats?: number;
  trackScrollDepth?: boolean;
};
type ErrorsOptions = { samplingRate?: number; debounceTimeout?: number };
type CwvOptions = { samplingRate?: number; metrics?: CwvMetric[] };
type ClickstreamOptions = {
  samplingRate?: number;
  clickSelector?: string;
  collectElementText?: boolean;
  formSelector?: string;
};

export type AutoEventsSettings = {
  // page_view / page_leave, plus optional page_engagement heartbeats
  pageEvents?: Toggle<PageEventsOptions>;
  // browser_error events from window.onerror / unhandledrejection
  errors?: Toggle<ErrorsOptions>;
  // Core Web Vitals
  cwv?: Toggle<CwvOptions>;
  // clicks, form submits, rage clicks
  clickstream?: Toggle<ClickstreamOptions>;

  // Shared across categories
  privacy?: PrivacySettings; // also inherited by other plugins
  trackQueryStringChanges?: boolean; // treat ?query changes as new pages
  hashAttribute?: string;
  samplingSeed?: string; // change to rerandomize the cohort
};

export const AUTO_EVENT_CATEGORIES = [
  "pageEvents",
  "errors",
  "cwv",
  "clickstream",
] as const;
export type AutoEventCategory = (typeof AUTO_EVENT_CATEGORIES)[number];

const ALL_METRICS: CwvMetric[] = ["FCP", "LCP", "INP", "CLS", "TTFB", "TBT"];
const DEFAULT_SAMPLING_RATE = 0.1;

type Resolved<T> = T & { enabled: boolean; samplingRate: number };

// Every category is off until local settings or remote sdkSettings turn it
// on. Remote overrides local, except a local `false`, which is definitive.
function resolveCategory<T extends { samplingRate?: number }>(
  name: AutoEventCategory,
  local: Toggle<T> | undefined,
  remote: AutoEventCategorySettings | undefined,
  defaults: T,
): Resolved<T> {
  const localSettings: Partial<T> & { enabled?: boolean } =
    typeof local === "boolean"
      ? ({ enabled: local } as Partial<T> & { enabled: boolean })
      : local
        ? { ...local, enabled: local.enabled ?? true }
        : {};
  const resolved = mergeSettings(
    { ...defaults, enabled: false, samplingRate: DEFAULT_SAMPLING_RATE },
    localSettings,
    remote,
  );
  if (localSettings.enabled === false) resolved.enabled = false;
  resolved.samplingRate = normalizeSamplingRate(
    remote ? remote.samplingRate : undefined,
    normalizeSamplingRate(
      localSettings.samplingRate,
      DEFAULT_SAMPLING_RATE,
      `autoEventsPlugin: ${name}.samplingRate`,
    ),
    `sdkSettings.autoEvents.${name}.samplingRate`,
  );
  return resolved;
}

export function autoEventsPlugin(settings: AutoEventsSettings = {}) {
  const {
    privacy,
    trackQueryStringChanges = false,
    hashAttribute = "id",
    samplingSeed = DEFAULT_SAMPLING_SEED,
  } = settings;
  sharePrivacySettings(privacy);

  return (gb: AnyGrowthBook) => {
    if (typeof window === "undefined" || typeof document === "undefined")
      return;

    const full: GrowthBook | null = isFullGrowthBook(gb) ? gb : null;
    const pageState = createPageState();
    const running: Partial<
      Record<AutoEventCategory, { key: string; stop: () => void }>
    > = {};
    let warned = false;

    // A category restarts when its resolved settings change, so a remote
    // sampling rate applies without a reload
    const toggle = (
      category: AutoEventCategory,
      resolved: { enabled: boolean },
      create: (() => () => void) | null,
    ) => {
      const key = create ? JSON.stringify(resolved) : "";
      const current = running[category];
      if (current && current.key === key) return;
      if (current) {
        current.stop();
        delete running[category];
      }
      if (create) running[category] = { key, stop: create() };
    };

    const sync = () => {
      const sdkSettings = gb.getDecryptedPayload().sdkSettings;
      const remote: AutoEventsRemoteSettings =
        (sdkSettings && sdkSettings.autoEvents) || {};

      const pageEvents = resolveCategory<PageEventsOptions>(
        "pageEvents",
        settings.pageEvents,
        remote.pageEvents,
        { heartbeats: false },
      );
      const errors = resolveCategory<ErrorsOptions>(
        "errors",
        settings.errors,
        remote.errors,
        {},
      );
      const cwv = resolveCategory<CwvOptions>(
        "cwv",
        settings.cwv,
        remote.cwv,
        {},
      );
      const clickstream = resolveCategory<ClickstreamOptions>(
        "clickstream",
        settings.clickstream,
        remote.clickstream,
        {},
      );

      if (!full && !warned) {
        const skipped = [
          pageEvents.enabled && "pageEvents",
          cwv.enabled && "cwv",
          clickstream.enabled && "clickstream",
        ].filter(Boolean);
        if (skipped.length) {
          warned = true;
          console.warn(
            `autoEventsPlugin: ${skipped.join(", ")} need a GrowthBook instance, skipping`,
          );
        }
      }

      toggle(
        "cwv",
        cwv,
        full && cwv.enabled
          ? () => {
              const metrics = new Set(cwv.metrics ?? ALL_METRICS);
              return createCWVReporter({
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
                growthbook: full,
              });
            }
          : null,
      );

      toggle(
        "errors",
        errors,
        errors.enabled
          ? () =>
              createErrorReporter({
                debounceTimeout: errors.debounceTimeout,
                samplingRate: errors.samplingRate,
                hashAttribute,
                samplingSeed,
                growthbook: gb,
              })
          : null,
      );

      toggle(
        "pageEvents",
        pageEvents,
        full && pageEvents.enabled
          ? () =>
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
                growthbook: full,
              })
          : null,
      );

      toggle(
        "clickstream",
        clickstream,
        full && clickstream.enabled
          ? () =>
              createInteractionReporter({
                samplingRate: clickstream.samplingRate,
                hashAttribute,
                samplingSeed,
                clickSelector: clickstream.clickSelector,
                collectElementText: clickstream.collectElementText,
                formSelector: clickstream.formSelector,
                privacy,
                pageState,
                growthbook: full,
              })
          : null,
      );
    };

    sync();
    if (full) {
      const off = full._subscribePayloadUpdates(sync);
      full.onDestroy(off);
    }
  };
}
