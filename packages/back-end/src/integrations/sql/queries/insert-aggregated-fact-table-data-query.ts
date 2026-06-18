import { format } from "shared/sql";
import { isRatioMetric, quantileMetricType } from "shared/experiments";
import type { InsertAggregatedFactTableDataQueryParams } from "shared/types/integrations";
import type { SqlDialect } from "shared/types/sql";

import { getFactMetricCTE } from "back-end/src/integrations/sql/ctes/fact-metric-cte";
import { getAggregationMetadata } from "back-end/src/integrations/sql/fact-metrics/aggregation-metadata";
import { encodeMetricIdForColumnName } from "back-end/src/integrations/sql/fact-metrics/encode-metric-id-for-column-name";
import { castToTimestamp } from "back-end/src/integrations/sql/primitives/cast-to-timestamp";
import { getAggregatedFactTableSchema } from "back-end/src/integrations/sql/fact-metrics/aggregated-fact-table-schema";

// A wide fact table (hundreds of metric columns) whose SQL has a JOIN can blow
// the per-worker memory budget on the final GROUP BY merge: the engine's first
// partial-aggregation pass hashes on the join key, not the group-by key, so a
// hot (idType, event_date) fans out into tens of thousands of wide partial rows
// that all land in one hash bucket. Salting the first GROUP BY by `__salt`
// spreads each key across SALT_BUCKETS buckets, forcing a clean repartition
// between the join and the merge; the second GROUP BY collapses the salt
// buckets back to one row per key (cheap — at most SALT_BUCKETS small rows per
// key). Dialects without `intHash` skip the salt layer and emit the original
// single-level GROUP BY.
export const SALT_BUCKETS = 32;

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

  // Level-1 partial aggregation: raw fact rows -> intermediate state per
  // (idType, event_date[, __salt]). Same expressions as before; the read path
  // re-aggregates these partials.
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

  // Level-2 merge: collapse salt buckets back to one partial row per
  // (idType, event_date). Uses each metric's associative `mergePartialsFunction`
  // (SUM for SUM/COUNT, MAX for MAX, HLL/KLL merge for sketches), so the
  // persisted state is identical to the un-salted single-level output.
  const mergeAggregations = metricCols
    .map(({ enc, numeratorMeta, denominatorMeta, isEventQuantile }) => {
      const numeratorCol = numeratorMeta
        ? `, ${numeratorMeta.mergePartialsFunction(
            `${enc}_value`,
          )} AS ${enc}_value`
        : "";
      const denominatorCol = denominatorMeta
        ? `, ${denominatorMeta.mergePartialsFunction(
            `${enc}_denominator_value`,
          )} AS ${enc}_denominator_value`
        : "";
      const nEventsCol = isEventQuantile
        ? `, SUM(COALESCE(${enc}_n_events, 0)) AS ${enc}_n_events`
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

  // Salt expression — hash on the raw event timestamp so a single
  // (idType, event_date) group's events spread across buckets. Dialects without
  // intHash get an empty layer (single-level GROUP BY, original behavior).
  const saltExpr = dialect.intHash
    ? `MOD(${dialect.intHash(dialect.castToString("timestamp"))}, ${SALT_BUCKETS})`
    : null;

  const dailyValuesCTEs = saltExpr
    ? `, __dailyValuesPartial AS (
        SELECT
          ${idType} AS ${idType}
          , ${dialect.castToDate("timestamp")} AS event_date
          , ${saltExpr} AS __salt
          , MAX(timestamp) AS slice_max_timestamp
          ${partialAggregations}
        FROM __factTable
        WHERE ${idType} IS NOT NULL
        GROUP BY
          ${idType}
          , ${dialect.castToDate("timestamp")}
          , ${saltExpr}
      )
      , __dailyValues AS (
        SELECT
          ${idType}
          , event_date
          , MAX(slice_max_timestamp) AS slice_max_timestamp
          ${mergeAggregations}
        FROM __dailyValuesPartial
        GROUP BY
          ${idType}
          , event_date
      )`
    : `, __dailyValues AS (
        SELECT
          ${idType} AS ${idType}
          , ${dialect.castToDate("timestamp")} AS event_date
          , MAX(timestamp) AS slice_max_timestamp
          ${partialAggregations}
        FROM __factTable
        WHERE ${idType} IS NOT NULL
        GROUP BY
          ${idType}
          , ${dialect.castToDate("timestamp")}
      )`;

  // The watermark (max source timestamp seen) used to be a separate
  // `__maxTimestamp` CTE selecting from `__factTable`. Engines that inline CTEs
  // (BigQuery) re-evaluate the fact-table SQL for that second reference, so a
  // wide FT with a JOIN was scanned twice. Carrying the per-group MAX through
  // __dailyValues and lifting it with a window in the final SELECT keeps it to
  // one scan; the window runs over already-aggregated rows so it's cheap.
  return format(
    `
    INSERT INTO ${tableFullName}
    (${columnNames.join(", \n")})
    SELECT * FROM (
      WITH __factTable AS (${factTableCTE})
      ${dailyValuesCTEs}
      SELECT
        dv.${idType} AS ${idType}
        , dv.event_date AS event_date
        , ${dialect.getCurrentTimestamp()} AS insertion_timestamp
        , ${castToTimestamp(
          "MAX(dv.slice_max_timestamp) OVER ()",
        )} AS max_timestamp
        ${finalMetricCols}
      FROM __dailyValues dv
    )
    `,
    dialect.formatDialect,
  );
}
