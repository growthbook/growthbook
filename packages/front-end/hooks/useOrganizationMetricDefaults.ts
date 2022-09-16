import { MetricDefaults } from "back-end/types/organization";
import { useMemo } from "react";
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
 */
export const useOrganizationMetricDefaults = (): MetricDefaults => {
  const orgSettings = useOrgSettings();

  return useMemo(
    () => ({
      ...METRIC_DEFAULTS,
      ...(orgSettings?.metricDefaults || {}),
    }),
    [orgSettings]
  );
};
