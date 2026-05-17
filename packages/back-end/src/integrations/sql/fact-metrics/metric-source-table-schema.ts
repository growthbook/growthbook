import { isRatioMetric, quantileMetricType } from "shared/experiments";
import type { FactMetricInterface } from "shared/types/fact-table";
import type { SqlDialect } from "shared/types/sql";

import { encodeMetricIdForColumnName } from "back-end/src/integrations/sql/fact-metrics/encode-metric-id-for-column-name";
import { getAggregationMetadata } from "back-end/src/integrations/sql/fact-metrics/aggregation-metadata";

export function getMetricSourceTableSchema(
  dialect: SqlDialect,
  baseIdType: string,
  metrics: FactMetricInterface[],
  // Which fact table this cache table is built from. When a metric source
  // group spans two fact tables (cross-fact-table ratio metrics), the
  // numerator aggregates and denominator aggregates are stored in separate
  // cache tables, one per fact table. When omitted, the schema includes every
  // column (the default behavior when numerator and denominator always live in
  // the same fact table).
  factTableId?: string,
): Map<string, string> {
  const schema = new Map<string, string>();

  schema.set(baseIdType, dialect.getDataType("string"));

  metrics.forEach((metric) => {
    const numeratorInThisTable =
      !factTableId || metric.numerator.factTableId === factTableId;
    const denominatorInThisTable =
      !factTableId || metric.denominator?.factTableId === factTableId;

    if (numeratorInThisTable) {
      const numeratorMetadata = getAggregationMetadata(dialect, {
        metric,
        useDenominator: false,
      });
      schema.set(
        `${encodeMetricIdForColumnName(metric.id)}_value`,
        dialect.getDataType(numeratorMetadata.intermediateDataType),
      );
    }

    if (isRatioMetric(metric) && denominatorInThisTable) {
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
    // rank queries).
    if (quantileMetricType(metric) === "event" && numeratorInThisTable) {
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
