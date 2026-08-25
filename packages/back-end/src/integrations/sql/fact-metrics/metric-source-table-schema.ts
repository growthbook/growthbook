import {
  isFactFunnelMetric,
  isRatioMetric,
  quantileMetricType,
} from "shared/experiments";
import type { FactMetricInterface } from "shared/types/fact-table";
import type { SqlDialect } from "shared/types/sql";

import { encodeMetricIdForColumnName } from "back-end/src/integrations/sql/fact-metrics/encode-metric-id-for-column-name";
import { getAggregationMetadata } from "back-end/src/integrations/sql/fact-metrics/aggregation-metadata";
import {
  funnelStepArrayColumn,
  funnelStepResolvedTsColumn,
} from "back-end/src/integrations/sql/fact-metrics/funnel-columns";

// Generates the cache table schema for a single per-fact-table metric source.
//
// Each metric contributes columns based on which of its column refs live in
// this cache's fact table:
//   - numerator side (`<metric>_value` + `<metric>_n_events` for event
//     quantiles) when `metric.numerator.factTableId === factTableId`
//   - denominator side (`<metric>_denominator_value`) when the metric is a
//     ratio and `metric.denominator.factTableId === factTableId`
//
// For same-FT metrics (non-ratio or same-FT ratio) the cache holds both sides
// in one schema. For cross-FT ratio metrics each cache holds exactly one side.
export function getMetricSourceTableSchema(
  dialect: SqlDialect,
  baseIdType: string,
  factTableId: string,
  metrics: FactMetricInterface[],
): Map<string, string> {
  const schema = new Map<string, string>();

  schema.set(baseIdType, dialect.getDataType("string"));

  metrics.forEach((metric) => {
    if (isFactFunnelMetric(metric)) {
      const prefix = encodeMetricIdForColumnName(metric.id);
      (metric.funnelSettings?.steps ?? []).forEach((step, stepIndex) => {
        if (step.factTableId !== factTableId) return;
        if (stepIndex === 0) {
          // Step 0 anchors on exposure (known at write), so it's resolved to a
          // scalar (windowed or not). DATETIME on BigQuery, not the units/refresh
          // `timestamp` type.
          schema.set(
            funnelStepResolvedTsColumn(prefix, 0),
            dialect.getDataType("datetime"),
          );
        } else {
          // Later steps anchor on a prior resolved step (cross-day) → arrays.
          schema.set(
            funnelStepArrayColumn(prefix, stepIndex),
            dialect.getDataType("arrayTimestamp"),
          );
        }
      });
      return;
    }

    const includeNumerator = metric.numerator?.factTableId === factTableId;
    const includeDenominator =
      isRatioMetric(metric) && metric.denominator?.factTableId === factTableId;

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

    if (includeDenominator) {
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
    // rank queries). Only emitted when this cache holds the numerator side.
    if (includeNumerator && quantileMetricType(metric) === "event") {
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
