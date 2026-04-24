import { isRatioMetric } from "shared/experiments";
import type {
  FactMetricInterface,
  FactTableInterface,
} from "shared/types/fact-table";
import type { FactTableMap } from "back-end/src/models/FactTableModel";

export function getFactTablesForMetrics(
  metrics: { metric: FactMetricInterface; index: number }[],
  factTableMap: FactTableMap,
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

  metrics.forEach(({ metric, index }) => {
    const numeratorFactTable = factTableMap.get(
      metric.numerator?.factTableId || "",
    );

    if (!numeratorFactTable) {
      throw new Error("Unknown fact table");
    }

    const existing = factTables[numeratorFactTable.id];
    if (existing) {
      existing.metrics.push({ metric, index });
    } else {
      factTables[numeratorFactTable.id] = {
        factTable: numeratorFactTable,
        metrics: [{ metric, index }],
      };
    }

    if (
      isRatioMetric(metric) &&
      metric.denominator?.factTableId &&
      metric.denominator?.factTableId !== metric.numerator?.factTableId
    ) {
      const denominatorFactTable = factTableMap.get(
        metric.denominator?.factTableId || "",
      );
      if (!denominatorFactTable) {
        throw new Error("Unknown fact table");
      }

      const denomExisting = factTables[denominatorFactTable.id];
      if (denomExisting) {
        denomExisting.metrics.push({ metric, index });
      } else {
        factTables[denominatorFactTable.id] = {
          factTable: denominatorFactTable,
          metrics: [{ metric, index }],
        };
      }
    }
  });

  if (Object.keys(factTables).length === 0) {
    throw new Error("No fact tables found");
  }
  // TODO(sql): Consider supporting more than two fact tables
  // for cases where you have < 20 metrics that span 3+ fact tables
  // and sometimes cross between them.
  if (Object.keys(factTables).length > 2) {
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
