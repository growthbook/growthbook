import { useCallback, useMemo } from "react";
import { MetricDefaults } from "back-end/types/organization";
import { MetricInterface } from "back-end/types/metric";
import useOrgSettings from "./useOrgSettings";

const defaultMaxPercentChange = 0.5;
const defaultMinPercentChange = 0.005;
const defaultMinSampleSize = 150;

const METRIC_DEFAULTS = {
  minimumSampleSize: defaultMinSampleSize,
  maxPercentageChange: defaultMaxPercentChange,
  minPercentageChange: defaultMinPercentChange,
};

/**
 * Metric defaults are stored at the organization settings level.
 * If an organization has them set, use them, otherwise use the hardcoded defaults.
 * Helper methods will consider zero (0) as a valid value.
 */
type OrganizationMetricDefaults = {
  /**
   * The default values, with this precedence:
   *  - organization defaults
   *  - hardcoded defaults
   */
  metricDefaults: MetricDefaults;

  /**
   * Returns the max percentage change for the provided metric,
   * considering 0 (zero) as a valid value.
   * Number returned is a multiplier value between 0-1,
   * e.g. for 50% you will get 0.5.
   * @param metric
   * @return number
   */
  getMaxPercentageChangeForMetric: (metric: Partial<MetricInterface>) => number;

  /**
   * Returns the min percentage change for the provided metric,
   * considering 0 (zero) as a valid value.
   * Number returned is a multiplier value between 0-1,
   * e.g. for 50% you will get 0.5.
   * @param metric
   * @return number
   */
  getMinPercentageChangeForMetric: (metric: Partial<MetricInterface>) => number;

  /**
   * Returns the minimum sample size for the provided metric,
   * considering 0 (zero) as a valid value.
   * @param metric
   * @return number
   */
  getMinSampleSizeForMetric: (metric: Partial<MetricInterface>) => number;
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
    [orgSettings]
  );

  /**
   * @link OrganizationMetricDefaults#getMaxPercentageChangeForMetric
   */
  const getMaxPercentageChangeForMetric = useCallback(
    (metric: Partial<MetricInterface>): number => {
      const value = metric.maxPercentChange;
      if (typeof value === "number") return value;

      return metricDefaults.maxPercentageChange;
    },
    [metricDefaults]
  );

  /**
   * @link OrganizationMetricDefaults#getMinPercentageChangeForMetric
   */
  const getMinPercentageChangeForMetric = useCallback(
    (metric: Partial<MetricInterface>): number => {
      const value = metric.minPercentChange;
      if (typeof value === "number") return value;

      return metricDefaults.minPercentageChange;
    },
    [metricDefaults]
  );

  /**
   * @link OrganizationMetricDefaults#getMinSampleSizeForMetric
   */
  const getMinSampleSizeForMetric = useCallback(
    (metric: Partial<MetricInterface>): number => {
      const value = metric.minSampleSize;
      if (typeof value === "number") return value;

      return metricDefaults.minimumSampleSize;
    },
    [metricDefaults]
  );

  return {
    metricDefaults,
    getMinPercentageChangeForMetric,
    getMaxPercentageChangeForMetric,
    getMinSampleSizeForMetric,
  };
};
