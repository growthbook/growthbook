import { isRatioMetric, quantileMetricType } from "shared/experiments";
import type { SqlDialect } from "shared/types/sql";

import { encodeMetricIdForColumnName } from "back-end/src/integrations/sql/fact-metrics/encode-metric-id-for-column-name";
import { getAggregationMetadata } from "back-end/src/integrations/sql/fact-metrics/aggregation-metadata";
import type { MetricSourceMetricEntry } from "shared/types/integrations";

// Returns the column schema for a single per-fact-table cache table. Each
// metric's contribution is driven by its `role`:
//   - "complete": same-fact-table metric — numerator _value, denominator _value
//     (if ratio), and _n_events (if event quantile).
//   - "numerator": cross-fact-table ratio metric, numerator side stored here
//     — numerator _value and _n_events (if event quantile).
//   - "denominator": cross-fact-table ratio metric, denominator side stored
//     here — denominator _value only.
export function getMetricSourceTableSchema(
  dialect: SqlDialect,
  baseIdType: string,
  metrics: MetricSourceMetricEntry[],
): Map<string, string> {
  const schema = new Map<string, string>();

  schema.set(baseIdType, dialect.getDataType("string"));

  metrics.forEach(({ metric, role }) => {
    const includeNumerator = role === "complete" || role === "numerator";
    const includeDenominator = role === "complete" || role === "denominator";

    if (includeNumerator) {
      const numeratorMetadata = getAggregationMetadata(dialect, {
        metric,
        useDenominator: false,
      });
      schema.set(
        `${encodeMetricIdForColumnName(metric.id)}_value`,
        dialect.getDataType(numeratorMetadata.intermediateDataType),
      );
    }

    if (isRatioMetric(metric) && includeDenominator) {
      const denominatorMetadata = getAggregationMetadata(dialect, {
        metric,
        useDenominator: true,
      });
      schema.set(
        `${encodeMetricIdForColumnName(metric.id)}_denominator_value`,
        dialect.getDataType(denominatorMetadata.intermediateDataType),
      );
    }

    // Event quantile metrics store a KLL sketch in _value plus a raw event
    // count per user-date. The count is needed to compute n_events and the
    // clustered-variance denominator at stats time (sketches cannot answer
    // rank queries). Event-quantile metrics are never ratio metrics, so they
    // only appear with role "complete".
    if (quantileMetricType(metric) === "event" && includeNumerator) {
      schema.set(
        `${encodeMetricIdForColumnName(metric.id)}_n_events`,
        dialect.getDataType("integer"),
      );
    }
  });

  schema.set("refresh_timestamp", dialect.getDataType("timestamp"));
  schema.set("max_timestamp", dialect.getDataType("timestamp"));
  schema.set("metric_date", dialect.getDataType("date"));

  return schema;
}
