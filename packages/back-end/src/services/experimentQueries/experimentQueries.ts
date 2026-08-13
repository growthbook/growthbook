import {
  ExperimentMetricInterface,
  isFactMetric,
  isLegacyMetric,
  isPercentileCappedMetric,
  isRegressionAdjusted,
  quantileMetricType,
  eligibleForUncappedMetric,
  isFactFunnelMetric,
  getFactMetricFactTableIds,
  parseFunnelStepMetricId,
} from "shared/experiments";
import { FactMetricInterface } from "shared/types/fact-table";
import { MetricInterface } from "shared/types/metric";
import { ExperimentSnapshotSettings } from "shared/types/experiment-snapshot";
import { OrganizationInterface } from "shared/types/organization";
import cloneDeep from "lodash/cloneDeep";
import { isManagedWarehouse } from "shared/util";
import { SourceIntegrationInterface } from "back-end/src/types/Integration";
import { orgHasPremiumFeature } from "back-end/src/enterprise";
import { applyMetricOverrides } from "back-end/src/util/integration";
import { getMaxHoursToConvert } from "back-end/src/integrations/sql/dates/max-hours-to-convert";
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

/**
 * The metrics a snapshot should actually query, resolved from its metric
 * settings.
 *
 * Funnel step metrics live in the metric map and in `metricSettings` so their
 * ids resolve for names, settings, and result lookups, but they are not
 * queryable: the parent funnel is queried once and its result block is split
 * per step afterwards (see `splitFunnelMetricBlock`). Querying a step would
 * double-count the parent and, since a step carries no funnel definition of its
 * own, produce wrong SQL. Every path that turns `metricSettings` into things to
 * query must go through here so that contract lives in one place.
 */
export function getQueryableMetricsFromSnapshotSettings(
  snapshotSettings: Pick<ExperimentSnapshotSettings, "metricSettings">,
  metricMap: Map<string, ExperimentMetricInterface>,
): ExperimentMetricInterface[] {
  return snapshotSettings.metricSettings
    .filter((m) => !parseFunnelStepMetricId(m.id).isFunnelStepMetric)
    .map((m) => metricMap.get(m.id))
    .filter((m): m is ExperimentMetricInterface => !!m);
}

// Gets all columns besides the speciality quantile and funnel columns for all metrics
export function getNonQuantileNonFunnelFloatColumns({
  metric,
  regressionAdjusted,
  isBandit,
}: {
  metric: FactMetricInterface;
  regressionAdjusted: boolean;
  isBandit: boolean;
}): string[] {
  // Funnel metrics emit none of the standard float columns; their block is one
  // `m{i}_step_{k}_sum` per step, sized in maxColumnsNeededForMetric.
  if (metric.metricType === "funnel") return [];

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
      case "quantile":
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
  efficientQuantileGrid = false,
}: {
  metric: FactMetricInterface;
  regressionAdjusted: boolean;
  isBandit: boolean;
  efficientQuantileGrid?: boolean;
}) {
  // id column
  const boilerplateCols = 1;

  // A funnel occupies one metric slot but emits one sum column per step, so
  // chunkMetrics has to budget for the step count, not for a fixed block.
  if (isFactFunnelMetric(metric)) {
    // TODO(funnel): when adding time from previous step, we should
    // account for those additional columns.
    return boilerplateCols + metric.funnelSettings.steps.length;
  }

  const floatCols = getNonQuantileNonFunnelFloatColumns({
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
        // it is packed into a single ARRAY column when supported
        (efficientQuantileGrid ? 1 : N_STAR_VALUES.length * 2)
      );
  }
}

export function chunkMetrics({
  metrics,
  maxColumnsPerQuery,
  isBandit,
  efficientQuantileGrid = false,
}: {
  metrics: {
    metric: FactMetricInterface;
    regressionAdjusted: boolean;
  }[];
  maxColumnsPerQuery: number;
  isBandit: boolean;
  efficientQuantileGrid?: boolean;
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
      efficientQuantileGrid,
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

export function getFactMetricGroup(
  metric: FactMetricInterface,
  { skipPartialData }: { skipPartialData: boolean },
) {
  // When `skipPartialData` is enabled, the experiment end date is pulled back to
  // exclude users who haven't had a full conversion window to convert.
  // Add the conversion window to the group key to keep same-window metrics grouped together
  const conversionWindowKey = skipPartialData
    ? `_cw${getMaxHoursToConvert(false, [metric], null)}`
    : "";

  // Metrics group on the exact set of fact tables they read from — a ratio's
  // numerator and denominator tables, or a funnel's per-step tables. Grouping
  // metrics whose sets merely overlap would make every metric in the query pay
  // for scanning and joining tables it doesn't use.
  const factTableIds = [...getFactMetricFactTableIds(metric)].sort();
  if (!factTableIds.length) return "";

  // Quantile metrics get their own group to prevent slowing down the main query
  // and because they do not support re-aggregation across pre-computed dimensions
  if (quantileMetricType(metric)) {
    return `${factTableIds.join(" ")}_qtile${conversionWindowKey}`;
  }

  if (factTableIds.length > 1) {
    return `${factTableIds.join(" ")} (cross-table metrics)${conversionWindowKey}`;
  }

  return `${factTableIds[0]}${conversionWindowKey}`;
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

  // Combining metrics in a single query is normally an Enterprise feature, but
  // we also enable it for the Managed Warehouse since GrowthBook owns the
  // compute and wants to run every optimization it can.
  if (
    !isManagedWarehouse(integration.datasource) &&
    !orgHasPremiumFeature(organization, "multi-metric-queries")
  ) {
    return defaultReturn;
  }

  // Group fact metrics into efficient groups (primarily if they share a fact table)
  const groups: Record<string, FactMetricInterface[]> = {};
  factMetrics.forEach((m) => {
    // Skip grouping metrics with percentile caps if they cannot be grouped at all
    if (
      m.cappingSettings.type === "percentile" &&
      !integration.getSourceProperties().canGroupPercentileCappedMetrics
    ) {
      return;
    }

    // Skip grouping quantile metrics if there's not an efficient implementation
    if (
      quantileMetricType(m) &&
      !integration.getSourceProperties().hasEfficientPercentiles
    ) {
      return;
    }

    const group = getFactMetricGroup(m, {
      skipPartialData: !!settings.skipPartialData,
    });
    if (group) {
      groups[group] = groups[group] || [];
      groups[group].push(m);
    }
  });

  const groupArrays: FactMetricInterface[][] = [];
  const sourceProps = integration.getSourceProperties();
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
      maxColumnsPerQuery: sourceProps.maxColumns,
      isBandit: !!settings.banditSettings,
      efficientQuantileGrid: !!sourceProps.hasArrayQuantileGrid,
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
