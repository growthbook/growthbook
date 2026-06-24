import { isRatioMetric } from "shared/experiments";
import type {
  FactMetricInterface,
  FactTableInterface,
} from "shared/types/fact-table";
import type { FactTableMap } from "back-end/src/models/FactTableModel";

// Builds the fact-table buckets for a set of metrics. By default, walks every
// metric and adds it to its numerator FT's bucket and (for cross-FT ratios)
// its denominator FT's bucket. The 2-FT cap is enforced in this mode because
// downstream multi-FT joins (e.g. inline experiment query + cross-FT stats
// query) only handle two caches.
//
// When `targetFactTableId` is provided, the function instead scopes output to
// that single fact table: a metric contributes only if its numerator or
// denominator references the target FT, and only that side is recorded. This
// is the right mode for per-FT incremental refresh inserts, where we're
// populating one cache and the OTHER sides of any cross-FT ratio metrics are
// populated by separate calls against their own target FTs. In this mode the
// 2-FT cap is irrelevant — by construction we return at most one bucket —
// so a pipeline like `[A/B, A/C]` can populate the FT_A cache without
// triggering the 2-FT cap on the union {A, B, C}.
export function getFactTablesForMetrics(
  metrics: { metric: FactMetricInterface; index: number }[],
  factTableMap: FactTableMap,
  targetFactTableId?: string,
): {
  factTable: FactTableInterface;
  index: number;
  metrics: { metric: FactMetricInterface; index: number }[];
}[] {
  const factTables: Record<
    string,
    {
      factTable: FactTableInterface;
      metrics: { metric: FactMetricInterface; index: number }[];
    }
  > = {};

  const addMetricToFactTable = (
    factTableId: string,
    metric: FactMetricInterface,
    index: number,
  ) => {
    if (targetFactTableId && factTableId !== targetFactTableId) return;
    const factTable = factTableMap.get(factTableId);
    if (!factTable) {
      throw new Error("Unknown fact table");
    }
    const existing = factTables[factTable.id];
    if (existing) {
      existing.metrics.push({ metric, index });
    } else {
      factTables[factTable.id] = {
        factTable,
        metrics: [{ metric, index }],
      };
    }
  };

  metrics.forEach(({ metric, index }) => {
    const numeratorFactTableId = metric.numerator?.factTableId || "";
    addMetricToFactTable(numeratorFactTableId, metric, index);

    if (
      isRatioMetric(metric) &&
      metric.denominator?.factTableId &&
      metric.denominator?.factTableId !== metric.numerator?.factTableId
    ) {
      addMetricToFactTable(metric.denominator.factTableId, metric, index);
    }
  });

  if (Object.keys(factTables).length === 0) {
    throw new Error("No fact tables found");
  }

  // The 2-FT cap only matters for multi-FT call sites (inline experiment
  // query + cross-FT stats query) where we actually join across caches.
  // Per-FT call sites pass `targetFactTableId` and never produce more than
  // one bucket, so the cap is both redundant and incorrect for them.
  // TODO(sql): Consider supporting more than two fact tables for cases
  // where you have < 20 metrics that span 3+ fact tables and sometimes
  // cross between them.
  if (!targetFactTableId && Object.keys(factTables).length > 2) {
    throw new Error(
      "Only two fact tables at a time are supported at the moment",
    );
  }

  return Object.values(factTables).map((f, i) => ({
    factTable: f.factTable,
    index: i,
    metrics: f.metrics,
  }));
}
