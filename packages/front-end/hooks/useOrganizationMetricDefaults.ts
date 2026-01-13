import { useCallback, useMemo } from "react";
import { OrganizationSettings } from "shared/types/organization";
import {
  MetricCappingSettings,
  MetricPriorSettings,
  MetricWindowSettings,
} from "shared/types/fact-table";
import {
  DEFAULT_MAX_PERCENT_CHANGE,
  DEFAULT_METRIC_CAPPING,
  DEFAULT_METRIC_CAPPING_VALUE,
  DEFAULT_METRIC_WINDOW,
  DEFAULT_METRIC_WINDOW_DELAY_HOURS,
  DEFAULT_METRIC_WINDOW_HOURS,
  DEFAULT_MIN_PERCENT_CHANGE,
  DEFAULT_MIN_SAMPLE_SIZE,
  DEFAULT_TARGET_MDE,
  DEFAULT_PROPER_PRIOR_STDDEV,
} from "shared/constants";
import useOrgSettings from "./useOrgSettings";

const defaultMetricWindowSettings: MetricWindowSettings = {
  type: DEFAULT_METRIC_WINDOW,
  windowValue: DEFAULT_METRIC_WINDOW_HOURS,
  windowUnit: "hours",
  delayValue: DEFAULT_METRIC_WINDOW_DELAY_HOURS,
  delayUnit: "hours",
};
const defaultMetricCappingSettings: MetricCappingSettings = {
  type: DEFAULT_METRIC_CAPPING,
  value: DEFAULT_METRIC_CAPPING_VALUE,
};
const defaultMetricPriorSettings: MetricPriorSettings = {
  override: false,
  proper: false,
  mean: 0,
  stddev: DEFAULT_PROPER_PRIOR_STDDEV,
};

export const METRIC_DEFAULTS = {
  minimumSampleSize: DEFAULT_MIN_SAMPLE_SIZE,
  maxPercentageChange: DEFAULT_MAX_PERCENT_CHANGE,
  minPercentageChange: DEFAULT_MIN_PERCENT_CHANGE,
  targetMDE: DEFAULT_TARGET_MDE,
  windowSettings: defaultMetricWindowSettings,
  cappingSettings: defaultMetricCappingSettings,
  priorSettings: defaultMetricPriorSettings,
};

/**
 * Metric defaults are stored at the organization settings level.
 * If an organization has them set, use them, otherwise use the hardcoded defaults.
 * Helper methods will consider zero (0) as a valid value.
 */
export type OrganizationMetricDefaults = {
  /**
   * The default values, with this precedence:
   *  - organization defaults
   *  - hardcoded defaults
   */
  metricDefaults: {
    minimumSampleSize: number;
    maxPercentageChange: number;
    minPercentageChange: number;
    targetMDE: number;
    windowSettings: MetricWindowSettings;
    cappingSettings: MetricCappingSettings;
    priorSettings: MetricPriorSettings;
  };

  /**
   * Returns the max percentage change for the provided metric,
   * considering 0 (zero) as a valid value.
   * Number returned is a multiplier value between 0-1,
   * e.g. for 50% you will get 0.5.
   * @param metric
   * @return number
   */
  getMaxPercentageChangeForMetric: (metric: {
    maxPercentChange?: number;
  }) => number;

  /**
   * Returns the min percentage change for the provided metric,
   * considering 0 (zero) as a valid value.
   * Number returned is a multiplier value between 0-1,
   * e.g. for 50% you will get 0.5.
   * @param metric
   * @return number
   */
  getMinPercentageChangeForMetric: (metric: {
    minPercentChange?: number;
  }) => number;

  /**
   * Returns the target minimum detectable effect for the provided metric,
   * considering 0 (zero) as a valid value.
   * Number returned is a multiplier value between 0-1,
   * e.g. for 1% you will get 0.01.
   * @param metric
   * @return number
   */
  getTargetMDEForMetric: (metric: { targetMDE?: number }) => number;

  /**
   * Returns the minimum metric total for the provided metric,
   * considering 0 (zero) as a valid value.
   * @param metric
   * @return number
   */
  getMinSampleSizeForMetric: (metric: { minSampleSize?: number }) => number;
};

export type OrganizationSettingsWithMetricDefaults = Omit<
  OrganizationSettings,
  "metricDefaults"
> & {
  metricDefaults: {
    minimumSampleSize: number;
    maxPercentageChange: number;
    minPercentageChange: number;
    targetMDE: number;
    priorSettings: MetricPriorSettings;
  };
};

export const useOrganizationMetricDefaults = (): OrganizationMetricDefaults => {
  const orgSettings = useOrgSettings();
  /**
   * @link OrganizationMetricDefaults#metricDefaults
   */
  const metricDefaults = useMemo(
    () => ({
      ...METRIC_DEFAULTS,
      ...(orgSettings?.metricDefaults || {}),
    }),
    [orgSettings],
  );
  /**
   * @link OrganizationMetricDefaults#getMaxPercentageChangeForMetric
   */
  const getMaxPercentageChangeForMetric = useCallback(
    (metric: { maxPercentChange?: number }): number => {
      const value = metric.maxPercentChange;
      if (typeof value === "number") return value;

      return metricDefaults.maxPercentageChange;
    },
    [metricDefaults],
  );

  /**
   * @link OrganizationMetricDefaults#getMinPercentageChangeForMetric
   */
  const getMinPercentageChangeForMetric = useCallback(
    (metric: { minPercentChange?: number }): number => {
      const value = metric.minPercentChange;
      if (typeof value === "number") return value;

      return metricDefaults.minPercentageChange;
    },
    [metricDefaults],
  );

  /**
   * @link OrganizationMetricDefaults#getTargetMDEForMetric
   */
  const getTargetMDEForMetric = useCallback(
    (metric: { targetMDE?: number }): number => {
      const value = metric.targetMDE;
      if (typeof value === "number") return value;

      return metricDefaults.targetMDE;
    },
    [metricDefaults],
  );

  /**
   * @link OrganizationMetricDefaults#getMinSampleSizeForMetric
   */
  const getMinSampleSizeForMetric = useCallback(
    (metric: { minSampleSize?: number }): number => {
      const value = metric.minSampleSize;
      if (typeof value === "number") return value;

      return metricDefaults.minimumSampleSize;
    },
    [metricDefaults],
  );

  return {
    metricDefaults,
    getMinPercentageChangeForMetric,
    getMaxPercentageChangeForMetric,
    getMinSampleSizeForMetric,
    getTargetMDEForMetric,
  };
};
