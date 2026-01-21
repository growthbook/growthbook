import {
  ExperimentMetricInterface,
  isFactMetric,
  isLegacyMetric,
  isPercentileCappedMetric,
  isRatioMetric,
  isRegressionAdjusted,
  quantileMetricType,
  eligibleForUncappedMetric,
} from "shared/experiments";
import { FactMetricInterface } from "shared/types/fact-table";
import { MetricInterface } from "shared/types/metric";
import { ExperimentSnapshotSettings } from "shared/types/experiment-snapshot";
import { OrganizationInterface } from "shared/types/organization";
import cloneDeep from "lodash/cloneDeep";
import { SourceIntegrationInterface } from "back-end/src/types/Integration";
import { orgHasPremiumFeature } from "back-end/src/enterprise";
import { applyMetricOverrides } from "back-end/src/util/integration";
import {
  BANDIT_CUPED_FLOAT_COLS,
  BASE_METRIC_CUPED_FLOAT_COLS,
  BASE_METRIC_CUPED_FLOAT_COLS_UNCAPPED,
  BASE_METRIC_FLOAT_COLS,
  BASE_METRIC_FLOAT_COLS_UNCAPPED,
  BASE_METRIC_PERCENTILE_CAPPING_FLOAT_COLS,
  MAX_METRICS_PER_QUERY,
  N_STAR_VALUES,
  RATIO_METRIC_CUPED_FLOAT_COLS,
  RATIO_METRIC_CUPED_FLOAT_COLS_UNCAPPED,
  RATIO_METRIC_FLOAT_COLS,
  RATIO_METRIC_PERCENTILE_CAPPING_FLOAT_COLS,
  RATIO_METRIC_FLOAT_COLS_UNCAPPED,
} from "./constants";

// Gets all columns besides the speciality quantile columns for all metrics
export function getNonQuantileFloatColumns({
  metric,
  regressionAdjusted,
  isBandit,
}: {
  metric: FactMetricInterface;
  regressionAdjusted: boolean;
  isBandit: boolean;
}): string[] {
  const baseCols = (() => {
    switch (metric.metricType) {
      case "mean":
      case "proportion":
      case "dailyParticipation":
      case "retention":
        return BASE_METRIC_FLOAT_COLS;
      case "ratio":
        return [...BASE_METRIC_FLOAT_COLS, ...RATIO_METRIC_FLOAT_COLS];
      case "quantile":
        return [...BASE_METRIC_FLOAT_COLS, ...RATIO_METRIC_FLOAT_COLS];
    }
  })();

  const cupedCols = (() => {
    if (!regressionAdjusted) {
      return [];
    }
    switch (metric.metricType) {
      case "mean":
      case "proportion":
      case "dailyParticipation":
      case "retention":
        return BASE_METRIC_CUPED_FLOAT_COLS;
      case "ratio":
        return [
          ...BASE_METRIC_CUPED_FLOAT_COLS,
          ...RATIO_METRIC_CUPED_FLOAT_COLS,
        ];
      case "quantile":
        return [
          ...BASE_METRIC_CUPED_FLOAT_COLS,
          ...RATIO_METRIC_CUPED_FLOAT_COLS,
        ];
    }
  })();

  const percentileCappingCols = (() => {
    if (!isPercentileCappedMetric(metric)) {
      return [];
    }
    switch (metric.metricType) {
      case "mean":
      case "proportion":
      case "dailyParticipation":
      case "retention":
        return BASE_METRIC_PERCENTILE_CAPPING_FLOAT_COLS;
      case "ratio":
        return [
          ...BASE_METRIC_PERCENTILE_CAPPING_FLOAT_COLS,
          ...RATIO_METRIC_PERCENTILE_CAPPING_FLOAT_COLS,
        ];
      case "quantile":
        return [];
    }
  })();

  const uncappedCols = (() => {
    if (!eligibleForUncappedMetric(metric)) {
      return [];
    }
    switch (metric.metricType) {
      case "proportion":
      case "retention":
        return [];
      case "mean":
      case "dailyParticipation":
        return [
          ...BASE_METRIC_FLOAT_COLS_UNCAPPED,
          ...(regressionAdjusted ? BASE_METRIC_CUPED_FLOAT_COLS_UNCAPPED : []),
        ];
      case "ratio":
        return [
          ...BASE_METRIC_FLOAT_COLS_UNCAPPED,
          ...RATIO_METRIC_FLOAT_COLS_UNCAPPED,
          ...(regressionAdjusted ? BASE_METRIC_CUPED_FLOAT_COLS_UNCAPPED : []),
          ...(regressionAdjusted ? RATIO_METRIC_CUPED_FLOAT_COLS_UNCAPPED : []),
        ];
      case "quantile":
        return [];
    }
  })();

  const cols = [
    ...baseCols,
    ...cupedCols,
    ...percentileCappingCols,
    ...uncappedCols,
  ];

  if (isBandit) {
    cols.push(...BANDIT_CUPED_FLOAT_COLS);
  }

  return cols;
}

export function maxColumnsNeededForMetric({
  metric,
  regressionAdjusted,
  isBandit,
}: {
  metric: FactMetricInterface;
  regressionAdjusted: boolean;
  isBandit: boolean;
}) {
  // id column
  const boilerplateCols = 1;

  const floatCols = getNonQuantileFloatColumns({
    metric,
    regressionAdjusted,
    isBandit,
  });
  switch (metric.metricType) {
    case "mean":
    case "proportion":
    case "dailyParticipation":
    case "retention":
    case "ratio":
      return boilerplateCols + floatCols.length;
    case "quantile":
      return (
        boilerplateCols +
        floatCols.length +
        // quantile_n and quantile
        2 +
        // quantile_lower and quantile_upper per n_star
        N_STAR_VALUES.length * 2
      );
  }
}

export function chunkMetrics({
  metrics,
  maxColumnsPerQuery,
  isBandit,
}: {
  metrics: {
    metric: FactMetricInterface;
    regressionAdjusted: boolean;
  }[];
  maxColumnsPerQuery: number;
  isBandit: boolean;
}): FactMetricInterface[][] {
  // up to 100 dimensions (overkill, but also adds in buffer)
  // + 1 for variation + 2 for users and count
  const baseColumnsNeeded = 103;

  const chunks: FactMetricInterface[][] = [];

  let runningCols = baseColumnsNeeded;
  let runningChunk: FactMetricInterface[] = [];
  metrics.forEach(({ metric: m, regressionAdjusted }) => {
    const colsNeeded = maxColumnsNeededForMetric({
      metric: m,
      regressionAdjusted,
      isBandit,
    });
    const updatedCols = runningCols + colsNeeded;
    if (
      updatedCols > maxColumnsPerQuery ||
      runningChunk.length >= MAX_METRICS_PER_QUERY
    ) {
      chunks.push([...runningChunk]);
      runningChunk = [m];
      runningCols = baseColumnsNeeded + colsNeeded;
    } else {
      runningChunk.push(m);
      runningCols = runningCols + colsNeeded;
    }
  });
  // Add whatever metrics are left in the last chunk
  if (runningChunk.length > 0) {
    chunks.push(runningChunk);
  }

  return chunks;
}

export function getFactMetricGroup(metric: FactMetricInterface) {
  // Ratio metrics must have the same numerator and denominator fact table to be grouped
  if (isRatioMetric(metric)) {
    if (metric.numerator.factTableId !== metric.denominator?.factTableId) {
      // TODO: smarter logic to make fewer groupings work
      const tableIds = [
        metric.numerator.factTableId,
        metric.denominator?.factTableId,
      ].sort((a, b) => a?.localeCompare(b ?? "") ?? 0);
      return tableIds.length >= 2
        ? `${tableIds[0]} ${tableIds[1]} (cross-table ratio metrics)`
        : metric.id;
    }
  }

  // Quantile metrics get their own group to prevent slowing down the main query
  // and because they do not support re-aggregation across pre-computed dimensions
  if (quantileMetricType(metric)) {
    return metric.numerator.factTableId
      ? `${metric.numerator.factTableId}_qtile`
      : "";
  }
  return metric.numerator.factTableId || "";
}

export interface GroupedMetrics {
  // Fact metrics grouped together or alone
  factMetricGroups: FactMetricInterface[][];
  // Legacy metrics always as singletons
  legacyMetricSingles: MetricInterface[];
}

export function getFactMetricGroups(
  metrics: ExperimentMetricInterface[],
  settings: ExperimentSnapshotSettings,
  integration: SourceIntegrationInterface,
  organization: OrganizationInterface,
): GroupedMetrics {
  const legacyMetrics: MetricInterface[] = metrics.filter((m) =>
    isLegacyMetric(m),
  );
  const factMetrics: FactMetricInterface[] = metrics.filter(isFactMetric);

  const defaultReturn: GroupedMetrics = {
    // by default, put all fact metrics in their own group
    factMetricGroups: factMetrics.map((m) => [m]),
    legacyMetricSingles: legacyMetrics,
  };

  // Combining metrics in a single query is an Enterprise-only feature
  if (!orgHasPremiumFeature(organization, "multi-metric-queries")) {
    return defaultReturn;
  }

  // Metrics might have different conversion windows which makes the query complicated
  // TODO(sql): join together metrics with the same date windows for some added efficiency
  if (settings.skipPartialData) {
    return defaultReturn;
  }

  // Org-level setting (in case the multi-metric query introduces bugs)
  // TODO(sql): deprecate this setting and hide it for orgs that have not set it
  if (organization.settings?.disableMultiMetricQueries) {
    return defaultReturn;
  }

  // Group fact metrics into efficient groups (primarily if they share a fact table)
  const groups: Record<string, FactMetricInterface[]> = {};
  factMetrics.forEach((m) => {
    // Skip grouping metrics with percentile caps or quantile metrics if there's not an efficient implementation
    if (
      (m.cappingSettings.type === "percentile" || quantileMetricType(m)) &&
      !integration.getSourceProperties().hasEfficientPercentiles
    ) {
      return;
    }

    const group = getFactMetricGroup(m);
    if (group) {
      groups[group] = groups[group] || [];
      groups[group].push(m);
    }
  });

  const groupArrays: FactMetricInterface[][] = [];
  Object.values(groups).forEach((group) => {
    // Split groups into chunks of MAX_METRICS_PER_QUERY
    const chunks = chunkMetrics({
      metrics: group.map((m) => {
        const metric = cloneDeep(m);
        // TODO(overrides): refactor overrides to beginning of analysis
        applyMetricOverrides(metric, settings);
        return {
          metric,
          regressionAdjusted:
            isRegressionAdjusted(metric) &&
            settings.regressionAdjustmentEnabled,
        };
      }),
      maxColumnsPerQuery: integration.getSourceProperties().maxColumns,
      isBandit: !!settings.banditSettings,
    });
    groupArrays.push(...chunks);
  });

  // Add unused fact metrics as singles to the group array
  const groupedMetricIds = new Set(
    groupArrays.flatMap((group) => group.map((g) => g.id)),
  );
  factMetrics.forEach((m) => {
    if (!groupedMetricIds.has(m.id)) {
      groupArrays.push([m]);
    }
  });

  return {
    factMetricGroups: groupArrays,
    legacyMetricSingles: legacyMetrics,
  };
}
