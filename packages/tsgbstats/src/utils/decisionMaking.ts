import type {
  MetricSettingsForStatsEngine,
  AnalysisSettingsForStatsEngine,
} from "../models/settings";

/**
 * Check if this metric/analysis combination qualifies for power calculation.
 * Power is only calculated for goal metrics with relative difference in overall analysis.
 */
export function decisionMakingConditions(
  metric: MetricSettingsForStatsEngine,
  analysis: AnalysisSettingsForStatsEngine,
): boolean {
  const businessMetricType = metric.businessMetricType;

  return (
    !!businessMetricType &&
    businessMetricType.includes("goal") &&
    analysis.differenceType === "relative" &&
    analysis.dimension === ""
  );
}
