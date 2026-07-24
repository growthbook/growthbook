import { isRatioMetric, quantileMetricType } from "shared/experiments";
import type { FactMetricInterface } from "shared/types/fact-table";
import type { SqlDialect } from "shared/types/sql";

import { encodeMetricIdForColumnName } from "back-end/src/integrations/sql/fact-metrics/encode-metric-id-for-column-name";
import { getAggregationMetadata } from "back-end/src/integrations/sql/fact-metrics/aggregation-metadata";

// Fixed (non-metric) columns of every aggregated fact table, in table order.
export const AGGREGATED_FACT_TABLE_EVENT_DATE_COLUMN = "event_date";
export const AGGREGATED_FACT_TABLE_INSERTION_TIMESTAMP_COLUMN =
  "insertion_timestamp";
// Event-time high-water mark of the slice; advances the registry watermark.
// Distinct from `insertion_timestamp` (wall-clock provenance of the write).
export const AGGREGATED_FACT_TABLE_MAX_TIMESTAMP_COLUMN = "max_timestamp";

// Schema (column -> warehouse type) for an aggregated fact table keyed on
// `idType`. Stores each metric's mergeable `intermediateDataType` (not
// `finalDataType`) so the read path can re-aggregate disjoint daily partials.
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

  // Sort by metric id so column order is stable across runs.
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

    // Event quantiles need a raw event count alongside the KLL sketch, since
    // sketches can't answer rank queries (used for n_events + clustered variance).
    if (includeNumerator && quantileMetricType(metric) === "event") {
      schema.set(
        `${encodeMetricIdForColumnName(metric.id)}_n_events`,
        dialect.getDataType("integer"),
      );
    }
  });

  return schema;
}
