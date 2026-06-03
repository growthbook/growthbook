import { format } from "shared/sql";
import { isRatioMetric, quantileMetricType } from "shared/experiments";
import type { InsertAggregatedFactTableDataQueryParams } from "shared/types/integrations";
import type { SqlDialect } from "shared/types/sql";

import { getFactMetricCTE } from "back-end/src/integrations/sql/ctes/fact-metric-cte";
import { getAggregationMetadata } from "back-end/src/integrations/sql/fact-metrics/aggregation-metadata";
import { encodeMetricIdForColumnName } from "back-end/src/integrations/sql/fact-metrics/encode-metric-id-for-column-name";
import { castToTimestamp } from "back-end/src/integrations/sql/primitives/cast-to-timestamp";
import { getAggregatedFactTableSchema } from "back-end/src/integrations/sql/fact-metrics/aggregated-fact-table-schema";

// Builds the append-only INSERT that materializes a new slice of daily
// aggregates into a shared aggregated fact table.
//
// Each run captures the new events since the event-time watermark
// (`timestamp > windowStartDate` when `exclusiveStart`) and aggregates them per
// `(idType, event_date)`. Every output row is therefore a *disjoint partial* of
// a distinct slice of events — multiple rows can exist per (idType, event_date)
// across runs, and the (deferred) read path re-aggregates them. There is no
// units-table join and no covariate-window filter; values are stored uncapped.
//
// Correctness relies on the serial-arrival assumption: events arrive in
// event-time order, so the `timestamp > watermark` slice sees each event
// exactly once.
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

  // getFactMetricCTE emits `m<index>_value` / `m<index>_denominator` /
  // `m<index>_n_events` per metric (role-gated by factTableId), plus the
  // `<idType>` and `timestamp` columns. No id join is needed because the
  // aggregated table is keyed on a native id type of this fact table.
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

      // Partial aggregation: we aggregate to the (idType, event_date) grain,
      // and the read path later re-aggregates the disjoint partials.
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

      // Event-quantile metrics carry a paired raw event count. For 'kll merge'
      // each source row is a pre-aggregated sketch covering many events, so SUM
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
