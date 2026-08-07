import { format } from "shared/sql";
import { isRatioMetric, quantileMetricType } from "shared/experiments";
import type { InsertAggregatedFactTableDataQueryParams } from "shared/types/integrations";
import type { SqlDialect } from "shared/types/sql";

import { getFactMetricCTE } from "back-end/src/integrations/sql/ctes/fact-metric-cte";
import { getAggregationMetadata } from "back-end/src/integrations/sql/fact-metrics/aggregation-metadata";
import { encodeMetricIdForColumnName } from "back-end/src/integrations/sql/fact-metrics/encode-metric-id-for-column-name";
import { castToTimestamp } from "back-end/src/integrations/sql/primitives/cast-to-timestamp";
import { toTimestampWithMs } from "back-end/src/integrations/sql/primitives/to-timestamp-with-ms";
import { getAggregatedFactTableSchema } from "back-end/src/integrations/sql/fact-metrics/aggregated-fact-table-schema";
import { getAggregatedFactTableStagingColumns } from "back-end/src/integrations/sql/queries/aggregated-fact-table-staging-query";

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
  // this fact table. When `sourceTableFullName` is set (shared-staging restate),
  // the event-grain rows have already been materialized with all idType columns
  // and `m{index}_*` value columns, so read the projection from there instead of
  // wrapping the fact-table SQL again.
  let factTableCTE: string;
  if (params.sourceTableFullName) {
    const stagingCols = getAggregatedFactTableStagingColumns({
      idTypes: [idType],
      metrics: sortedMetrics,
      factTableId: factTable.id,
    });
    const bounds: string[] = [
      `timestamp ${params.exclusiveStart ? ">" : ">="} ${toTimestampWithMs(
        params.windowStartDate,
      )}`,
    ];
    if (params.windowEndDate) {
      bounds.push(`timestamp < ${toTimestampWithMs(params.windowEndDate)}`);
    }
    factTableCTE = `
      SELECT ${stagingCols.join(", ")}
      FROM ${params.sourceTableFullName}
      WHERE ${bounds.join(" AND ")}
    `;
  } else {
    factTableCTE = getFactMetricCTE(dialect, {
      baseIdType: idType,
      idJoinMap: {},
      factTable,
      startDate: params.windowStartDate,
      endDate: params.windowEndDate ?? null,
      metricsWithIndices: sortedMetrics.map((metric, index) => ({
        metric,
        index,
      })),
      addFiltersToWhere: true,
      exclusiveStartDateFilter: params.exclusiveStart,
      // Chunk boundaries are half-open [start, end) so chained chunks tile the
      // window without overlap or gaps.
      exclusiveEndDateFilter: true,
      castIdToString: true,
    });
  }

  // Per-metric column shape, computed once so the partial / merge / final
  // projections stay aligned.
  const metricCols = sortedMetrics.map((metric, index) => {
    const includeNumerator = metric.numerator.factTableId === factTable.id;
    const includeDenominator =
      isRatioMetric(metric) && metric.denominator?.factTableId === factTable.id;
    const enc = encodeMetricIdForColumnName(metric.id);
    const numeratorMeta = includeNumerator
      ? getAggregationMetadata(dialect, { metric, useDenominator: false })
      : null;
    const denominatorMeta = includeDenominator
      ? getAggregationMetadata(dialect, { metric, useDenominator: true })
      : null;
    const isEventQuantile =
      includeNumerator && quantileMetricType(metric) === "event";
    return {
      metric,
      index,
      enc,
      numeratorMeta,
      denominatorMeta,
      isEventQuantile,
    };
  });

  // Partial aggregation to the (idType, event_date) grain; the read path
  // re-aggregates the disjoint partials.
  const partialAggregations = metricCols
    .map(({ metric, index, enc, numeratorMeta, denominatorMeta }) => {
      const numeratorCol = numeratorMeta
        ? `, ${numeratorMeta.partialAggregationFunction(
            `m${index}_value`,
          )} AS ${enc}_value`
        : "";
      const denominatorCol = denominatorMeta
        ? `, ${denominatorMeta.partialAggregationFunction(
            `m${index}_denominator`,
          )} AS ${enc}_denominator_value`
        : "";
      // 'kll merge' rows are pre-aggregated sketches over many events, so SUM
      // the paired count; otherwise COUNT the contributing values.
      const nEventsCol =
        numeratorMeta && quantileMetricType(metric) === "event"
          ? metric.numerator.aggregation === "kll merge"
            ? `, SUM(COALESCE(m${index}_n_events, 0)) AS ${enc}_n_events`
            : `, COUNT(m${index}_value) AS ${enc}_n_events`
          : "";
      return `${numeratorCol}${denominatorCol}${nEventsCol}`;
    })
    .join("\n");

  const finalMetricCols = metricCols
    .map(({ enc, numeratorMeta, denominatorMeta, isEventQuantile }) => {
      const numeratorCol = numeratorMeta ? `, ${enc}_value` : "";
      const denominatorCol = denominatorMeta
        ? `, ${enc}_denominator_value`
        : "";
      const nEventsCol = isEventQuantile ? `, ${enc}_n_events` : "";
      return `${numeratorCol}${denominatorCol}${nEventsCol}`;
    })
    .join("\n");

  // The watermark (max source timestamp seen) is carried through as a per-group
  // MAX and lifted with a window in the final SELECT, rather than a separate
  // `__maxTimestamp` CTE. Engines that inline CTEs (BigQuery) re-evaluate the
  // fact-table SQL for a second reference, so a wide FT with a JOIN was scanned
  // twice; this keeps it to one scan and the window runs over already-aggregated
  // rows so it's cheap.
  return format(
    `
    INSERT INTO ${tableFullName}
    (${columnNames.join(", \n")})
    SELECT * FROM (
      WITH __factTable AS (${factTableCTE})
      , __dailyValues AS (
        SELECT
          ${idType} AS ${idType}
          , ${dialect.castToDate("timestamp")} AS event_date
          , MAX(timestamp) AS __max_ts
          ${partialAggregations}
        FROM __factTable
        WHERE ${idType} IS NOT NULL
        GROUP BY
          ${idType}
          , ${dialect.castToDate("timestamp")}
      )
      SELECT
        dv.${idType} AS ${idType}
        , dv.event_date AS event_date
        , ${dialect.getCurrentTimestamp()} AS insertion_timestamp
        , ${castToTimestamp("MAX(dv.__max_ts) OVER ()")} AS max_timestamp
        ${finalMetricCols}
      FROM __dailyValues dv
    )
    `,
    dialect.formatDialect,
  );
}
