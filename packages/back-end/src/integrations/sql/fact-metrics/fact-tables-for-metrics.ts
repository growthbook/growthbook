import { getFactMetricFactTableIds } from "shared/experiments";
import type {
  FactMetricInterface,
  FactTableInterface,
} from "shared/types/fact-table";
import type { FactTableMap } from "back-end/src/models/FactTableModel";

// Builds the fact-table buckets for a set of metrics. By default, walks every
// metric and adds it to a bucket for each fact table it reads from: the
// numerator's, the denominator's for cross-FT ratios, and every step's for
// funnels (whose steps can each come from a different table).
//
// When `targetFactTableId` is provided, the function instead scopes output to
// that single fact table: a metric contributes only if its numerator or
// denominator references the target FT, and only that side is recorded. This
// is the right mode for per-FT incremental refresh inserts, where we're
// populating one cache and the OTHER sides of any cross-FT ratio metrics are
// populated by separate calls against their own target FTs.
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
    getFactMetricFactTableIds(metric).forEach((factTableId) => {
      addMetricToFactTable(factTableId, metric, index);
    });
  });

  if (Object.keys(factTables).length === 0) {
    throw new Error("No fact tables found");
  }

  return Object.values(factTables).map((f, i) => ({
    factTable: f.factTable,
    index: i,
    metrics: f.metrics,
  }));
}
