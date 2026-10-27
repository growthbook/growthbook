import { isFactMetric } from "shared/experiments";
import type {
  FactMetricInterface,
  FactTableInterface,
} from "shared/types/fact-table";
import {
  InterleavingMetricConfig,
  INTERLEAVING_RANKING_ID_COLUMN,
  INTERLEAVING_ITEM_ID_COLUMN,
} from "shared/validators";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import { getMetricMap } from "back-end/src/models/MetricModel";
import { getFactTableMap } from "back-end/src/models/FactTableModel";

type Context = ReqContext | ApiReqContext;

export type InterleavingAnalysisInputs = {
  datasourceId: string;
  userIdType: string;
  metrics: InterleavingMetricConfig[];
};

export type ResolvedInterleavingMetric = {
  config: InterleavingMetricConfig;
  metric: FactMetricInterface;
  factTable: FactTableInterface;
};

// Per-item values are summed/maxed again across impressions, which sketch
// and distinct-count aggregations don't support
const UNSUPPORTED_AGGREGATIONS = new Set([
  "count distinct",
  "hll merge",
  "kll merge",
]);

/**
 * Load and validate the fact metrics an interleaving analysis reads. Used
 * both when saving an Interleaving and when running a snapshot, so a bad
 * setup is reported at save time with the same message it would fail with
 * at run time.
 */
export async function resolveInterleavingMetrics(
  context: Context,
  { datasourceId, userIdType, metrics }: InterleavingAnalysisInputs,
): Promise<ResolvedInterleavingMetric[]> {
  const [metricMap, factTableMap] = await Promise.all([
    getMetricMap(context),
    getFactTableMap(context),
  ]);

  return metrics.map((config) => {
    const metricId = config.id;
    const label = "Interleaving metric";
    const metric = metricMap.get(metricId);
    if (!metric || !isFactMetric(metric)) {
      throw new Error(`${label} must be an existing fact metric: ${metricId}`);
    }
    const ref = `${label} "${metric.name}"`;
    if (metric.datasource !== datasourceId) {
      throw new Error(`${ref} must belong to datasource ${datasourceId}`);
    }
    // Funnel metrics have no numerator
    if (!metric.numerator) {
      throw new Error(`${ref} must read from a fact table`);
    }
    const factTable = factTableMap.get(metric.numerator.factTableId);
    if (!factTable) {
      throw new Error(`Fact table not found for ${ref}`);
    }
    if (!factTable.userIdTypes.includes(userIdType)) {
      throw new Error(
        `${ref} requires the '${userIdType}' identifier type on its fact table`,
      );
    }
    const hasColumn = (column: string) =>
      factTable.columns.some((c) => c.column === column && !c.deleted);
    if (!hasColumn(INTERLEAVING_ITEM_ID_COLUMN)) {
      throw new Error(
        `${ref} requires an '${INTERLEAVING_ITEM_ID_COLUMN}' column on its fact table`,
      );
    }
    // Paired analysis joins engagement per impression
    if (
      config.analyses.some((a) => a.type === "paired") &&
      !hasColumn(INTERLEAVING_RANKING_ID_COLUMN)
    ) {
      throw new Error(
        `${ref} needs an '${INTERLEAVING_RANKING_ID_COLUMN}' column on its fact table to be joined per impression`,
      );
    }
    const { metricType, numerator } = metric;
    if (metricType !== "mean" && metricType !== "proportion") {
      throw new Error(
        `Interleaving metrics must be mean or proportion metrics: "${metric.name}" is a ${metricType} metric`,
      );
    }
    if (
      numerator.column === "$$distinctDates" ||
      UNSUPPORTED_AGGREGATIONS.has(numerator.aggregation ?? "")
    ) {
      throw new Error(
        `Interleaving metrics must use sum, max, or count aggregations: "${metric.name}"`,
      );
    }
    // An aggregate filter thresholds a per-user total, but interleaving
    // aggregates per item, so there is no grain that preserves the metric's
    // meaning. Accepting one would silently report a sum where the metric
    // defines an indicator.
    if (numerator.aggregateFilter && numerator.aggregateFilterColumn) {
      throw new Error(
        `Interleaving metrics cannot use a user filter yet: "${metric.name}"`,
      );
    }
    return { config, metric, factTable };
  });
}
