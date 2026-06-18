import { format } from "shared/sql";
import { isRatioMetric, quantileMetricType } from "shared/experiments";
import type { InsertAggregatedFactTableDataQueryParams } from "shared/types/integrations";
import type { SqlDialect } from "shared/types/sql";

import { getFactMetricCTE } from "back-end/src/integrations/sql/ctes/fact-metric-cte";
import { getAggregationMetadata } from "back-end/src/integrations/sql/fact-metrics/aggregation-metadata";
import { encodeMetricIdForColumnName } from "back-end/src/integrations/sql/fact-metrics/encode-metric-id-for-column-name";
import { castToTimestamp } from "back-end/src/integrations/sql/primitives/cast-to-timestamp";
import { getAggregatedFactTableSchema } from "back-end/src/integrations/sql/fact-metrics/aggregated-fact-table-schema";

// Optional salted two-level GROUP BY (off by default; see DEFAULT_SALT_BUCKETS).
//
// A wide fact table whose SQL has a JOIN can blow the per-worker memory budget
// on the final GROUP BY merge: the engine's first partial-aggregation pass
// hashes on the join key, not the group-by key, so a hot (idType, event_date)
// fans out into many wide partial rows that all land in one hash bucket.
// Salting the first GROUP BY by `__salt` spreads each key across N buckets;
// the second GROUP BY collapses the salt buckets back to one row per key.
//
// This is *not* the primary defence against wide-FT restate stalls — that is
// date chunking in AggregatedFactTableQueryRunner (each chunk's output fits
// the engine's per-stage write budget). Salt is extra insurance for extreme
// per-chunk skew, opt-in per fact table via
// `aggregatedFactTableSettings.saltBuckets`.
//
// Dialects without `intHash` ignore the salt setting and always emit the
// single-level GROUP BY.
export const DEFAULT_SALT_BUCKETS = 0;

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
  // (idType, event_date) group's events spread across buckets. Off by default
  // (saltBuckets = 0); opt-in per fact table. Dialects without intHash ignore
  // it.
  const saltBuckets = params.saltBuckets ?? DEFAULT_SALT_BUCKETS;
  const saltExpr =
    saltBuckets > 0 && dialect.intHash
      ? `MOD(${dialect.intHash(dialect.castToString("timestamp"))}, ${saltBuckets})`
      : null;

  // Level-2 merge: collapse salt buckets back to one partial row per
  // (idType, event_date). Uses each metric's associative `mergePartialsFunction`
  // (SUM for SUM/COUNT, MAX for MAX, HLL/KLL merge for sketches), so the
  // persisted state is identical to the un-salted single-level output. Within a
  // restate chunk the input is small enough that whether the optimizer folds
  // the two CTE levels back into one is immaterial.
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

  // The watermark (max source timestamp seen) used to be a separate
  // `__maxTimestamp` CTE selecting from `__factTable`. Engines that inline CTEs
  // (BigQuery) re-evaluate the fact-table SQL for that second reference, so a
  // wide FT with a JOIN was scanned twice. Carrying the per-group MAX through
  // and lifting it with a window in the final SELECT keeps it to one scan; the
  // window runs over already-aggregated rows so it's cheap.
  const dailyValuesCte = saltExpr
    ? `
      , __dailyValuesPartial AS (
        SELECT
          ${idType} AS ${idType}
          , ${dialect.castToDate("timestamp")} AS event_date
          , ${saltExpr} AS __salt
          , MAX(timestamp) AS __max_ts
          ${partialAggregations}
        FROM __factTable
        WHERE ${idType} IS NOT NULL
        GROUP BY 1, 2, 3
      )
      , __dailyValues AS (
        SELECT
          ${idType}
          , event_date
          , MAX(__max_ts) AS __max_ts
          ${mergeAggregations}
        FROM __dailyValuesPartial
        GROUP BY 1, 2
      )`
    : `
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
      )`;

  return format(
    `
    INSERT INTO ${tableFullName}
    (${columnNames.join(", \n")})
    SELECT * FROM (
      WITH __factTable AS (${factTableCTE})
      ${dailyValuesCte}
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
