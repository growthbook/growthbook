import { isRatioMetric, quantileMetricType } from "shared/experiments";
import type { FactMetricInterface } from "shared/types/fact-table";

import { encodeMetricIdForColumnName } from "back-end/src/integrations/sql/fact-metrics/encode-metric-id-for-column-name";

// Columns a metric materializes in an aggregated fact table (role-gated),
// mirroring `getAggregatedFactTableSchema`.
export function getColumnsForMetric(
  metric: FactMetricInterface,
  factTableId: string,
): string[] {
  const enc = encodeMetricIdForColumnName(metric.id);
  const columns: string[] = [];
  if (metric.numerator.factTableId === factTableId) {
    columns.push(`${enc}_value`);
    if (quantileMetricType(metric) === "event") {
      columns.push(`${enc}_n_events`);
    }
  }
  if (
    isRatioMetric(metric) &&
    metric.denominator?.factTableId === factTableId
  ) {
    columns.push(`${enc}_denominator_value`);
  }
  return columns;
}
