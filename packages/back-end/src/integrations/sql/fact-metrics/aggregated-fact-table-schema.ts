import { isRatioMetric, quantileMetricType } from "shared/experiments";
import type { FactMetricInterface } from "shared/types/fact-table";
import type { SqlDialect } from "shared/types/sql";

import { encodeMetricIdForColumnName } from "back-end/src/integrations/sql/fact-metrics/encode-metric-id-for-column-name";
import { getAggregationMetadata } from "back-end/src/integrations/sql/fact-metrics/aggregation-metadata";

// Fixed (non-metric) columns of every aggregated fact table, in table order.
export const AGGREGATED_FACT_TABLE_EVENT_DATE_COLUMN = "event_date";
export const AGGREGATED_FACT_TABLE_INSERTION_TIMESTAMP_COLUMN =
  "insertion_timestamp";
// Event-time high-water mark of the slice that produced each row. Used to
// advance the registry watermark (mirrors the metric-source cache's
// `max_timestamp`). Distinct from `insertion_timestamp`, which is wall-clock
// provenance of when the row was written.
export const AGGREGATED_FACT_TABLE_MAX_TIMESTAMP_COLUMN = "max_timestamp";

// Generates the schema (column name -> warehouse data type) for a shared daily
// aggregated fact table keyed on `idType`.
//
// Each metric contributes columns based on which of its column refs live in
// this fact table (role-gated, mirroring `getMetricSourceTableSchema`):
//   - numerator side (`<metric>_value`, plus `<metric>_n_events` for event
//     quantiles) when `metric.numerator.factTableId === factTableId`
//   - denominator side (`<metric>_denominator_value`) when the metric is a
//     ratio and `metric.denominator.factTableId === factTableId`
//
// IMPORTANT: these daily partials are re-aggregated over a *variable* covariate
// window at read time, so we store each metric's mergeable
// `intermediateDataType` (integer/float/date/hll/quantileSketch), NOT the
// `finalDataType` the per-experiment covariate cache uses. The read path
// re-aggregates the disjoint partials with `reAggregationFunction`.
export function getAggregatedFactTableSchema(
  dialect: SqlDialect,
  {
    idType,
    factTableId,
    metrics,
  }: {
    idType: string;
    factTableId: string;
    metrics: FactMetricInterface[];
  },
): Map<string, string> {
  const schema = new Map<string, string>();

  schema.set(idType, dialect.getDataType("string"));
  schema.set(
    AGGREGATED_FACT_TABLE_EVENT_DATE_COLUMN,
    dialect.getDataType("date"),
  );
  schema.set(
    AGGREGATED_FACT_TABLE_INSERTION_TIMESTAMP_COLUMN,
    dialect.getDataType("timestamp"),
  );
  schema.set(
    AGGREGATED_FACT_TABLE_MAX_TIMESTAMP_COLUMN,
    dialect.getDataType("timestamp"),
  );

  // Sort by metric id so column order is stable across runs regardless of the
  // order metrics are supplied.
  const sortedMetrics = [...metrics].sort((a, b) => a.id.localeCompare(b.id));

  sortedMetrics.forEach((metric) => {
    const includeNumerator = metric.numerator.factTableId === factTableId;
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
    // count per (idType, event_date). The count is needed downstream to
    // compute n_events and the clustered-variance denominator (sketches cannot
    // answer rank queries). Only emitted when this table holds the numerator.
    if (includeNumerator && quantileMetricType(metric) === "event") {
      schema.set(
        `${encodeMetricIdForColumnName(metric.id)}_n_events`,
        dialect.getDataType("integer"),
      );
    }
  });

  return schema;
}
