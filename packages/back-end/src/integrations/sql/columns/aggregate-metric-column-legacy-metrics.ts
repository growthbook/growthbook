import type { MetricInterface } from "shared/types/metric";
import type { SqlDialect } from "shared/types/sql";
import { replaceCountStar } from "back-end/src/util/sql";

import { getMetricQueryFormat } from "back-end/src/integrations/sql/fact-metrics/metric-query-format";

export function getAggregateMetricColumnLegacyMetrics(
  dialect: SqlDialect,
  { metric }: { metric: MetricInterface },
): string {
  // Binomial metrics don't have a value, so use hard-coded "1" as the value
  if (metric.type === "binomial") {
    return `MAX(COALESCE(value, 0))`;
  }

  // SQL editor
  if (getMetricQueryFormat(metric) === "sql") {
    // Custom aggregation that's a hardcoded number (e.g. "1")
    if (metric.aggregation && Number(metric.aggregation)) {
      // Note that if user has conversion row but value IS NULL, this will
      // return 0 for that user rather than `metric.aggregation`
      return dialect.ifElse("value IS NOT NULL", metric.aggregation, "0");
    }
    // Other custom aggregation
    else if (metric.aggregation) {
      return replaceCountStar(metric.aggregation, `value`);
    }
    // Standard aggregation (SUM)
    else {
      return `SUM(COALESCE(value, 0))`;
    }
  }
  // Query builder
  else {
    // Count metrics that specify a distinct column to count
    if (metric.type === "count" && metric.column) {
      return `COUNT(DISTINCT (value))`;
    }
    // Count metrics just do a simple count of rows by default
    else if (metric.type === "count") {
      return `COUNT(value)`;
    }
    // Revenue and duration metrics use MAX by default
    else {
      return `MAX(COALESCE(value, 0))`;
    }
  }
}
