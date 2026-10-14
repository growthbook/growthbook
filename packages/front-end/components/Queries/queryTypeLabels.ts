import { QueryType } from "shared/types/query";

// A Record, so adding a QueryType without a label fails type-check
const QUERY_TYPE_LABELS: Record<QueryType, string> = {
  unknown: "Unknown",
  pastExperiment: "Experiment import",
  dimensionSlices: "Dimension slices",
  populationMetric: "Power Calculator",
  populationMultiMetric: "Power Calculator",
  experimentMetric: "Experiment metric",
  experimentMultiMetric: "Experiment metrics",
  experimentTraffic: "Experiment traffic",
  experimentUnits: "Experiment units",
  experimentDropUnitsTable: "Experiment units cleanup",
  experimentIncrementalRefreshCreateUnitsTable:
    "Incremental refresh: create units",
  experimentIncrementalRefreshDropUnitsTable: "Incremental refresh: drop units",
  experimentIncrementalRefreshDropTempUnitsTable:
    "Incremental refresh: drop temp units",
  experimentIncrementalRefreshUpdateUnitsTable:
    "Incremental refresh: update units",
  experimentIncrementalRefreshAlterUnitsTable:
    "Incremental refresh: alter units",
  experimentIncrementalRefreshMaxTimestampUnitsTable:
    "Incremental refresh: find latest units",
  experimentIncrementalRefreshCreateMetricsSourceTable:
    "Incremental refresh: create metrics",
  experimentIncrementalRefreshInsertMetricsSourceData:
    "Incremental refresh: insert metrics",
  experimentIncrementalRefreshMaxTimestampMetricsSource:
    "Incremental refresh: find latest metrics",
  experimentIncrementalRefreshDropMetricsCovariateTable:
    "Incremental refresh: drop CUPED",
  experimentIncrementalRefreshCreateMetricsCovariateTable:
    "Incremental refresh: create CUPED",
  experimentIncrementalRefreshInsertMetricsCovariateData:
    "Incremental refresh: insert CUPED",
  experimentIncrementalRefreshInsertMetricsCovariateDataFromAggregated:
    "Incremental refresh: insert CUPED from aggregated tables",
  experimentIncrementalRefreshStatistics: "Incremental refresh: statistics",
  experimentIncrementalRefreshHealth: "Incremental refresh: health",
  aggregatedFactTableDrop: "Aggregated table: drop",
  aggregatedFactTableCreate: "Aggregated table: create",
  aggregatedFactTableInsertData: "Aggregated table: insert",
  aggregatedFactTableMaxTimestamp: "Aggregated table: find latest",
  metricAnalysis: "Metric analysis",
  impactEstimate: "Impact estimate",
  productAnalyticsExploration: "Product analytics",
  freeFormQuery: "SQL Explorer",
  exposureQueryValidation: "Experiment Assignment Query validation",
  featureUsageQueryValidation: "Feature usage query validation",
  connectionTest: "Connection test",
  informationSchema: "Schema browser: tables",
  tableColumns: "Schema browser: columns",
  factTableValidation: "Fact table validation",
  pipelineValidation: "Pipeline permissions check",
  userExposure: "User exposure lookup",
  featureEvalDiagnostics: "Feature Flag diagnostics",
  columnTopValues: "Column top values",
  trackedEvents: "Tracked event discovery",
  sessionReplayList: "Session replay list",
  sessionReplayDetail: "Session replay detail",
  askDataAgentQuery: "Ask Data",
  experimentResults: "Experiment results (legacy)",
  testQuery: "Test query",
  factTableTest: "Fact table test",
  exposureQueryTest: "Experiment Assignment Query test",
  contextualBanditQueryTest: "Contextual Bandit query test",
  identityJoinTest: "Identity join test",
  featureUsageQueryTest: "Feature usage query test",
  metricTest: "Metric test",
  segmentTest: "Segment test",
  dimensionTest: "Dimension test",
};

// querylogs stores queryType as a plain string, so unknown values pass through
export function getQueryTypeLabel(queryType: string): string {
  return queryType in QUERY_TYPE_LABELS
    ? QUERY_TYPE_LABELS[queryType as QueryType]
    : queryType;
}
