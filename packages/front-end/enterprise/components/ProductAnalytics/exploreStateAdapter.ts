// Adapter functions to convert between ExploreState and MetricExplorerBlockInterface format
// This allows us to reuse existing components that expect the block format

import { ExploreState } from "shared/enterprise";
import { MetricAnalysisSettings } from "shared/types/metric-analysis";

/**
 * Converts ExploreState to a format compatible with components expecting MetricExplorerBlockInterface
 */
export function exploreStateToBlockFormat(state: ExploreState): any {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(endDate.getDate() - state.lookbackDays);

  // Map visualizationType: ExploreState uses "timeseries", block format uses "timeseries" (same)
  // But block format also supports "histogram" which ExploreState doesn't have
  const visualizationType =
    state.visualizationType === "timeseries"
      ? "timeseries"
      : state.visualizationType === "bar"
        ? "bar"
        : state.visualizationType === "bigNumber"
          ? "bigNumber"
          : "timeseries";

  return {
    ...state,
    visualizationType,
    analysisSettings: {
      userIdType: "user_id", // Default, will be determined from fact table/metric
      startDate,
      endDate,
      lookbackDays: state.lookbackDays,
      granularity: state.granularity || "day",
      groupBy: state.groupBy || [],
      populationType: "factTable" as const,
      populationId: null,
      additionalNumeratorFilters: [],
      additionalDenominatorFilters: [],
    },
    // Add other required fields with defaults
    factMetricId:
      state.series.find((s) => s.type === "metric")?.config &&
      "factMetricId" in state.series.find((s) => s.type === "metric")!.config
        ? (state.series.find((s) => s.type === "metric")!.config as any)
            .factMetricId
        : "",
    valueType: "avg" as const,
    metricAnalysisId: "",
  };
}

/**
 * Converts block format updates back to ExploreState
 */
export function blockFormatToExploreState(
  block: any,
  currentState: ExploreState,
): ExploreState {
  const analysisSettings = block.analysisSettings || {};

  // Map visualizationType back: block format uses "timeseries", ExploreState uses "timeseries" (same)
  let visualizationType = currentState.visualizationType;
  if (block.visualizationType) {
    if (
      block.visualizationType === "timeseries" ||
      block.visualizationType === "bar" ||
      block.visualizationType === "bigNumber"
    ) {
      visualizationType = block.visualizationType;
    }
  }

  return {
    ...currentState,
    lookbackDays: analysisSettings.lookbackDays ?? currentState.lookbackDays,
    granularity: analysisSettings.granularity ?? currentState.granularity,
    visualizationType,
    groupBy: analysisSettings.groupBy ?? currentState.groupBy,
    globalRowFilters: block.globalRowFilters ?? currentState.globalRowFilters,
    // Keep series as is
    series: currentState.series,
  };
}
