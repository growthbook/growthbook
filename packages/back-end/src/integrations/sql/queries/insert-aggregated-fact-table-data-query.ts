import { format } from "shared/sql";
import { isRatioMetric, quantileMetricType } from "shared/experiments";
import type { InsertAggregatedFactTableDataQueryParams } from "shared/types/integrations";
import type { SqlDialect } from "shared/types/sql";

import { getFactMetricCTE } from "back-end/src/integrations/sql/ctes/fact-metric-cte";
import { getAggregationMetadata } from "back-end/src/integrations/sql/fact-metrics/aggregation-metadata";
import { encodeMetricIdForColumnName } from "back-end/src/integrations/sql/fact-metrics/encode-metric-id-for-column-name";
import { castToTimestamp } from "back-end/src/integrations/sql/primitives/cast-to-timestamp";
import { getAggregatedFactTableSchema } from "back-end/src/integrations/sql/fact-metrics/aggregated-fact-table-schema";

// Append-only INSERT materializing a new slice of daily aggregates per
// `(idType, event_date)`. Each output row is a disjoint partial of one event
// slice (multiple rows per key across runs), re-aggregated by the read path.
// Correctness relies on serial arrival: events arrive in event-time order, so
// the `timestamp > watermark` slice sees each event exactly once.
export function getInsertAggregatedFactTableDataQuery(
  dialect: SqlDialect,
  params: InsertAggregatedFactTableDataQueryParams,
): string {
  const { factTable, idType, tableFullName } = params;

  if (!factTable.userIdTypes.includes(idType)) {
    throw new Error(
      `Fact table "${factTable.id}" does not have id type "${idType}".`,
    );
  }

  // Stable column order, matching the CREATE TABLE schema.
  const sortedMetrics = [...params.metrics].sort((a, b) =>
    a.id.localeCompare(b.id),
  );

  const schema = getAggregatedFactTableSchema(dialect, {
    idType,
    factTableId: factTable.id,
    metrics: sortedMetrics,
  });
  const columnNames = Array.from(schema.keys());

  // No id join is needed: the aggregated table is keyed on a native id type of
  // this fact table.
  const factTableCTE = getFactMetricCTE(dialect, {
    baseIdType: idType,
    idJoinMap: {},
    factTable,
    startDate: params.windowStartDate,
    endDate: null,
    metricsWithIndices: sortedMetrics.map((metric, index) => ({
      metric,
      index,
    })),
    addFiltersToWhere: true,
    exclusiveStartDateFilter: params.exclusiveStart,
    castIdToString: true,
  });

  const dailyAggregations = sortedMetrics
    .map((metric, index) => {
      const includeNumerator = metric.numerator.factTableId === factTable.id;
      const includeDenominator =
        isRatioMetric(metric) &&
        metric.denominator?.factTableId === factTable.id;

      const enc = encodeMetricIdForColumnName(metric.id);

      // Partial aggregation to the (idType, event_date) grain; the read path
      // re-aggregates the disjoint partials.
      const numeratorCol = includeNumerator
        ? `, ${getAggregationMetadata(dialect, {
            metric,
            useDenominator: false,
          }).partialAggregationFunction(`m${index}_value`)} AS ${enc}_value`
        : "";

      const denominatorCol = includeDenominator
        ? `, ${getAggregationMetadata(dialect, {
            metric,
            useDenominator: true,
          }).partialAggregationFunction(
            `m${index}_denominator`,
          )} AS ${enc}_denominator_value`
        : "";

      // 'kll merge' rows are pre-aggregated sketches over many events, so SUM
      // the paired count; otherwise COUNT the contributing values.
      const nEventsCol =
        includeNumerator && quantileMetricType(metric) === "event"
          ? metric.numerator.aggregation === "kll merge"
            ? `, SUM(COALESCE(m${index}_n_events, 0)) AS ${enc}_n_events`
            : `, COUNT(m${index}_value) AS ${enc}_n_events`
          : "";

      return `${numeratorCol}${denominatorCol}${nEventsCol}`;
    })
    .join("\n");

  const finalMetricCols = sortedMetrics
    .map((metric) => {
      const includeNumerator = metric.numerator.factTableId === factTable.id;
      const includeDenominator =
        isRatioMetric(metric) &&
        metric.denominator?.factTableId === factTable.id;
      const enc = encodeMetricIdForColumnName(metric.id);
      const numeratorCol = includeNumerator ? `, ${enc}_value` : "";
      const denominatorCol = includeDenominator
        ? `, ${enc}_denominator_value`
        : "";
      const nEventsCol =
        includeNumerator && quantileMetricType(metric) === "event"
          ? `, ${enc}_n_events`
          : "";
      return `${numeratorCol}${denominatorCol}${nEventsCol}`;
    })
    .join("\n");

  return format(
    `
    INSERT INTO ${tableFullName}
    (${columnNames.join(", \n")})
    SELECT * FROM (
      WITH __factTable AS (${factTableCTE})
      , __maxTimestamp AS (
        SELECT ${castToTimestamp("MAX(timestamp)")} AS max_timestamp FROM __factTable
      )
      , __dailyValues AS (
        SELECT
          ${idType} AS ${idType}
          , ${dialect.castToDate("timestamp")} AS event_date
          ${dailyAggregations}
        FROM __factTable
        GROUP BY
          ${idType}
          , ${dialect.castToDate("timestamp")}
      )
      SELECT
        dv.${idType} AS ${idType}
        , dv.event_date AS event_date
        , ${dialect.getCurrentTimestamp()} AS insertion_timestamp
        , mt.max_timestamp AS max_timestamp
        ${finalMetricCols}
      FROM __dailyValues dv
      CROSS JOIN __maxTimestamp mt
    )
    `,
    dialect.formatDialect,
  );
}
