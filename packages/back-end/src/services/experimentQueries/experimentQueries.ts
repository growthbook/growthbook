import {
  ExperimentMetricInterface,
  isFactMetric,
  isLegacyMetric,
  isRatioMetric,
  quantileMetricType,
} from "shared/experiments";
import { FactMetricInterface, FactMetricType } from "back-end/types/fact-table";
import { SourceIntegrationInterface } from "back-end/src/types/Integration";
import { orgHasPremiumFeature } from "back-end/src/enterprise";
import { ExperimentSnapshotSettings } from "back-end/types/experiment-snapshot";
import { MetricInterface } from "back-end/types/metric";
import { OrganizationInterface } from "back-end/types/organization";
import {
  BASE_METRIC_FLOAT_COLS,
  MAX_METRICS_PER_QUERY,
  N_STAR_VALUES,
  RATIO_METRIC_FLOAT_COLS,
} from "./constants";

export function maxColumnsNeededForMetricType(metricType: FactMetricType) {
  // id column
  const boilerplateCols = 1;
  switch (metricType) {
    case "mean":
    case "proportion":
    case "dailyParticipation":
    case "retention":
      return boilerplateCols + BASE_METRIC_FLOAT_COLS.length;
    case "ratio":
      return boilerplateCols + RATIO_METRIC_FLOAT_COLS.length;
    case "quantile":
      return (
        boilerplateCols +
        // needed for event quantiles
        RATIO_METRIC_FLOAT_COLS.length +
        // quantile_n and quantile
        2 +
        // quantile_lower and quantile_upper per n_star
        N_STAR_VALUES.length * 2
      );
  }
}

export function chunkMetrics(
  metrics: FactMetricInterface[],
  // From integration settings
  maxColumnsPerQuery: number,
) {
  // up to 100 dimensions (overkill, but also adds in buffer)
  // + 1 for variation + 2 for users and count
  const baseColumnsNeeded = 103;

  const chunks: FactMetricInterface[][] = [];

  let runningCols = baseColumnsNeeded;
  let runningChunk: FactMetricInterface[] = [];
  metrics.forEach((m) => {
    const colsNeeded = maxColumnsNeededForMetricType(m.metricType);
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
    const chunks = chunkMetrics(
      group,
      integration.getSourceProperties().maxColumns,
    );
    groupArrays.push(...chunks);
  });

  // Add unused fact metrics as singles to the group array
  factMetrics.forEach((m) => {
    if (!groupArrays.some((group) => group.includes(m))) {
      groupArrays.push([m]);
    }
  });

  return {
    factMetricGroups: groupArrays,
    legacyMetricSingles: legacyMetrics,
  };
}
