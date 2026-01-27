import type {
  MetricSettingsForStatsEngine,
  AnalysisSettingsForStatsEngine,
} from "../models/settings";

/**
 * Check if post-stratification can be applied to this metric/analysis combination.
 */
export function testPostStratEligible(
  metric: MetricSettingsForStatsEngine,
  analysis: AnalysisSettingsForStatsEngine,
): boolean {
  if (!analysis.postStratificationEnabled) {
    return false;
  }

  // Quantile metrics are not eligible for post-stratification
  if (
    metric.statisticType === "quantile_unit" ||
    metric.statisticType === "quantile_event"
  ) {
    return false;
  }

  return true;
}
