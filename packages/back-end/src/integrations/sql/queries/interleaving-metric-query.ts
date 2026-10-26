import { buildMinimalOrCondition, format } from "shared/sql";
import {
  getColumnExpression,
  getColumnRefWhereClause,
  getFactTableIdColumnExpression,
  getFactTableTemplateVariables,
  getFactTableTimestampColumn,
} from "shared/experiments";
import {
  INTERLEAVING_EXPERIMENT_ID_COLUMN,
  INTERLEAVING_RANKING_ID_COLUMN,
  INTERLEAVING_ITEM_FIELD_COMPETITIVE,
  INTERLEAVING_ITEM_FIELD_ITEM_ID,
  INTERLEAVING_ITEM_FIELD_VARIATION,
  INTERLEAVING_ITEM_ID_COLUMN,
  INTERLEAVING_ITEMS_COLUMN,
  INTERLEAVING_TIMESTAMP_COLUMN,
  InterleavingAnalysis,
} from "shared/validators";
import type {
  InterleavingMetricQueryMetric,
  InterleavingMetricQueryParams,
} from "shared/types/integrations";
import type {
  ColumnRef,
  FactMetricInterface,
  FactTableInterface,
} from "shared/types/fact-table";
import type { SqlDialect } from "shared/types/sql";
import { compileSqlTemplate } from "back-end/src/util/sql";
import { getFactMetricColumn } from "back-end/src/integrations/sql/columns/fact-metric-column";
import { getAggregationMetadata } from "back-end/src/integrations/sql/fact-metrics/aggregation-metadata";
import { encodeMetricIdForColumnName } from "back-end/src/integrations/sql/fact-metrics/encode-metric-id-for-column-name";

/**
 * Output column for one statistic of one metric. Keyed by metric id (not
 * position) so the analysis can read results from the frozen metric list
 * without re-resolving metrics or depending on how queries were grouped.
 */
export function interleavingMetricColumn(metricId: string, stat: string) {
  return `${encodeMetricIdForColumnName(metricId)}_${stat}`;
}

/**
 * Sufficient-statistics query for interleaving experiments: one query per
 * fact table, covering every metric on that table and each analysis
 * requested on it. Output columns are named by interleavingMetricColumn;
 * paired and preference statistic names do not collide.
 *
 * The exposure query returns ONE ROW PER IMPRESSION with the item detail in
 * an `items` JSON column (the SDK's nested exposure shape). __exposures
 * unnests it per warehouse dialect and groups to one row per
 * (user, ranking, competitive item), which also collapses SDK retries.
 *
 * Metric values use the experiment fact-metric resolution (numerator column
 * and row filters via getFactMetricColumn/getColumnRefWhereClause, per-unit
 * aggregation via getAggregationMetadata). __eventRows is the single filtered
 * fact-table source; each analysis aggregates it at the grain it needs.
 *
 * - "paired": __events aggregates by impression x item, then __credited joins
 *   exposures to engagement via ranking_id (NULL ids never match) ->
 *   __impression (x, y, n per impression) -> __pairedUser (sums over engaged
 *   impressions only, where engaged means at least one row matching the
 *   metric's filters was credited to the impression). n counts
 *   treatment-drafted competitive exposures; both x and y are normalized by
 *   it, which a fair team draft balances in expectation. The final SELECT
 *   emits cross-user joint moments for the paired delta-method t-test.
 * - "preference": __share (per user x item treatment share over all
 *   competitive exposures, i.e. exposureCount attribution) joined to
 *   __preferenceEvents (post-first-exposure engagement per user x item) ->
 *   __preferenceUser (fractional win totals) -> user preference counts for the
 *   sign test.
 *
 * v1 limitations (documented): metric capping and conversion windows are
 * not applied; the snapshot date range bounds both exposures and engagement.
 * Impression joins filter on MIN(timestamp) >= exposure timestamp over rows
 * matching THAT metric's row filters: an item whose first such event precedes
 * the exposure is dropped for that metric, one with mixed pre/post events
 * counts all of them — acceptable since engagement follows exposure within an
 * impression. The timestamp is per metric so the metrics sharing a query stay
 * independent.
 */

// One metric with the SQL fragments its CTEs need
type PlanEntry = {
  // Index within the query, used for intermediate CTE columns
  i: number;
  // Output column prefix (see interleavingMetricColumn)
  out: (stat: string) => string;
  paired: boolean;
  preference: boolean;
  // Aggregated metric value at either analysis's event grain
  value: string;
  // Earliest row in the group matching THIS metric's filters, NULL when it
  // matched none. Per metric because __eventRows is the OR of every metric's
  // filters, so a shared timestamp would let one metric's pre-exposure row
  // suppress another's valid engagement.
  firstEventTs: string;
};

type Plan = {
  entries: PlanEntry[];
  paired: PlanEntry[];
  preference: PlanEntry[];
  // Metric row filters, OR'd into the __events WHERE clause
  filterGroups: string[][];
};

function numeratorOf(metric: FactMetricInterface): ColumnRef {
  if (!metric.numerator) {
    throw new Error(`Interleaving metric ${metric.id} has no numerator`);
  }
  return metric.numerator;
}

function rowFilters(
  dialect: SqlDialect,
  columnRef: ColumnRef,
  factTable: FactTableInterface,
): string[] {
  return getColumnRefWhereClause({
    factTable,
    columnRef,
    escapeStringLiteral: dialect.escapeStringLiteral,
    stringMatch: dialect.stringMatch,
    jsonExtract: dialect.jsonExtract,
    evalBoolean: dialect.evalBoolean,
    castToTimestamp: dialect.castToTimestamp,
    identifierQuote: dialect.identifierQuote,
  });
}

function buildPlan(
  dialect: SqlDialect,
  factTable: FactTableInterface,
  metrics: InterleavingMetricQueryMetric[],
  eventTs: string,
): Plan {
  const filterGroups: string[][] = [];

  const entries = metrics.map(({ analyses, metric }, i): PlanEntry => {
    const has: Record<InterleavingAnalysis["type"], boolean> = {
      paired: false,
      preference: false,
    };
    for (const analysis of analyses) has[analysis.type] = true;
    const numerator = numeratorOf(metric);
    const filters = rowFilters(dialect, numerator, factTable);
    filterGroups.push(filters);
    const filterSql = filters.length ? filters.join(" AND ") : null;
    const rowValue = getFactMetricColumn(
      dialect,
      metric,
      numerator,
      factTable,
      "m",
    ).value;
    const agg = getAggregationMetadata(dialect, {
      metric,
      useDenominator: false,
    });
    return {
      i,
      out: (stat) => interleavingMetricColumn(metric.id, stat),
      ...has,
      value: agg.fullAggregationFunction(
        filterSql
          ? `CASE WHEN (${filterSql}) THEN ${rowValue} ELSE NULL END`
          : rowValue,
      ),
      // Groups are never empty, so an unfiltered metric matched every row.
      firstEventTs: filterSql
        ? `MIN(CASE WHEN (${filterSql}) THEN ${eventTs} ELSE NULL END)`
        : `MIN(${eventTs})`,
    };
  });

  return {
    entries,
    paired: entries.filter((e) => e.paired),
    preference: entries.filter((e) => e.preference),
    filterGroups,
  };
}

export function getInterleavingMetricQuery(
  dialect: SqlDialect,
  params: InterleavingMetricQueryParams,
): string {
  const { userIdType, trackingKey, variationKeys, startDate, endDate } = params;

  if (params.metrics.length === 0) {
    throw new Error("Interleaving metric query requires at least one metric");
  }
  const { jsonArray } = dialect;
  if (!jsonArray) {
    throw new Error(
      "Interleaving analysis is not supported for this Data Source type yet",
    );
  }

  const { factTable } = params;
  const eventTs = `m.${getFactTableTimestampColumn(factTable)}`;

  const plan = buildPlan(dialect, factTable, params.metrics, eventTs);
  const includePaired = plan.paired.length > 0;
  const includePreference = plan.preference.length > 0;

  const compiled = {
    startDate,
    endDate: endDate ?? undefined,
    experimentId: trackingKey,
  };
  const [controlKey, treatmentKey] = variationKeys;
  const ts = INTERLEAVING_TIMESTAMP_COLUMN;
  const lit = (value: string) => `'${dialect.escapeStringLiteral(value)}'`;
  const dateFilter = (col: string) =>
    `${col} >= ${dialect.toTimestamp(startDate)}` +
    (endDate ? ` AND ${col} <= ${dialect.toTimestamp(endDate)}` : "");
  const item = (field: string) => jsonArray.fieldText("item", field);
  const cols = (parts: string[]) => parts.join(",\n        ");

  // 1 for treatment picks, 0 for control picks. Both arms are explicit so a
  // misconfigured key yields NULL (dropped by the aggregates) rather than
  // silently counting as control; the WHERE below makes NULL unreachable.
  const variation = item(INTERLEAVING_ITEM_FIELD_VARIATION);
  const teamExpr = `CASE
          WHEN ${variation} = ${lit(treatmentKey)} THEN 1
          WHEN ${variation} = ${lit(controlKey)} THEN 0
        END`;

  // Join keys are normalised to string on both sides of every join below.
  // `fieldText` always yields text, while the fact table's columns are
  // whatever the warehouse declares, so a numeric item_id would otherwise
  // fail the join outright (Postgres: "operator does not exist: integer =
  // text"). Casting happens in the projecting CTE, not the ON clause, so
  // ClickHouse still sees an equi-join.
  const itemId = dialect.castToString(item(INTERLEAVING_ITEM_FIELD_ITEM_ID));
  const exposureRankingId = dialect.castToString(
    `e.${INTERLEAVING_RANKING_ID_COLUMN}`,
  );

  // One row per (user, ranking, competitive item). Grouping collapses
  // double-logged impressions (SDK retries) and repeated items in a list.
  const exposuresCTE = `
    __exposures AS (
      SELECT
        ${cols([
          `e.${userIdType} AS user_id`,
          `${exposureRankingId} AS ranking_id`,
          `${itemId} AS item_id`,
          `MAX(${teamExpr}) AS team`,
          `MIN(e.${ts}) AS exposure_timestamp`,
        ])}
      FROM (
        ${compileSqlTemplate(params.exposureQuery, compiled)}
      ) e
      ${jsonArray.unnest(`e.${INTERLEAVING_ITEMS_COLUMN}`, "item")}
      WHERE e.${INTERLEAVING_EXPERIMENT_ID_COLUMN} = ${lit(trackingKey)}
        AND ${item(INTERLEAVING_ITEM_FIELD_COMPETITIVE)} = 'true'
        AND ${variation} IN (${lit(controlKey)}, ${lit(treatmentKey)})
        AND ${dateFilter(`e.${ts}`)}
      GROUP BY e.${userIdType}, ${exposureRankingId}, ${itemId}
    )`;

  // Treatment share and first exposure for each user x item. Preference
  // engagement is only eligible after this timestamp.
  const shareCTE = `
    __share AS (
      SELECT
        e.user_id,
        e.item_id,
        AVG(e.team * 1.0) AS share_t,
        MIN(e.exposure_timestamp) AS first_exposure_timestamp
      FROM __exposures e
      GROUP BY e.user_id, e.item_id
    )`;

  // The single filtered fact-table source. The analysis-specific CTEs below
  // aggregate these rows independently so selecting one analysis cannot alter
  // the other's results.
  const eventUserId = getFactTableIdColumnExpression(
    factTable,
    userIdType,
    dialect,
    "m",
  );
  // Resolved like every other fact-table column so virtual columns and JSON
  // paths work, then cast to match the exposure side's string keys.
  const eventColumn = (column: string) =>
    dialect.castToString(
      getColumnExpression(
        column,
        factTable,
        dialect.jsonExtract,
        "m",
        dialect.identifierQuote,
      ),
    );
  const eventItemId = eventColumn(INTERLEAVING_ITEM_ID_COLUMN);
  const eventRankingId = eventColumn(INTERLEAVING_RANKING_ID_COLUMN);
  const eventRowsWhere = [
    dateFilter(eventTs),
    buildMinimalOrCondition(plan.filterGroups),
  ]
    .filter(Boolean)
    .join("\n        AND ");
  const eventRowsCTE = `
    __eventRows AS (
      SELECT m.*
      FROM (
        ${compileSqlTemplate(
          factTable.sql,
          {
            ...compiled,
            templateVariables: getFactTableTemplateVariables(factTable),
          },
          dialect,
        )}
      ) m
      WHERE ${eventRowsWhere}
    )`;

  const eventsCTE = `
    __events AS (
      SELECT
        ${cols([
          `${eventUserId} AS user_id`,
          `${eventRankingId} AS ranking_id`,
          `${eventItemId} AS item_id`,
          ...plan.paired.flatMap((e) => [
            `${e.value} AS value_${e.i}`,
            `${e.firstEventTs} AS first_event_ts_${e.i}`,
          ]),
        ])}
      FROM __eventRows m
      GROUP BY ${eventUserId}, ${eventRankingId}, ${eventItemId}
    )`;

  const preferenceEventsCTE = `
    __preferenceEvents AS (
      SELECT
        ${cols([
          `${eventUserId} AS user_id`,
          `${eventItemId} AS item_id`,
          ...plan.preference.map((e) => `${e.value} AS value_${e.i}`),
        ])}
      FROM __eventRows m
      INNER JOIN __share s ON (
        s.user_id = ${eventUserId}
        AND s.item_id = ${eventItemId}
      )
      WHERE ${eventTs} >= s.first_exposure_timestamp
      GROUP BY ${eventUserId}, ${eventItemId}
    )`;

  // Paired chain

  // Every competitive exposure with the engagement on the same impression x
  // item at or after it (NULL ranking_id events never match). The timestamp
  // test lives in the credited columns, not the ON, so the join stays an equi-join
  // (ClickHouse requires that; the join key yields at most one ev row).
  // A NULL timestamp means this metric matched nothing in the group, so the
  // same expression doubles as the has-event indicator.
  const credited = (i: number) =>
    dialect.ifElse(`ev.first_event_ts_${i} >= e.exposure_timestamp`, "1", "0");
  const creditedCTE = `
    __credited AS (
      SELECT
        ${cols([
          "e.user_id",
          "e.ranking_id",
          "e.team",
          ...plan.paired.flatMap((e) => [
            `COALESCE(ev.value_${e.i} * ${credited(e.i)}, 0) AS value_${e.i}`,
            `COALESCE(${credited(e.i)}, 0) AS has_event_${e.i}`,
          ]),
        ])}
      FROM __exposures e
      LEFT JOIN __events ev ON (
        ev.user_id = e.user_id
        AND ev.ranking_id = e.ranking_id
        AND ev.item_id = e.item_id
      )
    )`;

  // Per impression: treatment engagement, control engagement, and the number
  // of treatment-drafted competitive exposures
  const impressionCTE = `
    __impression AS (
      SELECT
        ${cols([
          "c.user_id",
          "c.ranking_id",
          ...plan.paired.flatMap((e) => [
            `SUM(c.team * c.value_${e.i}) AS treatment_${e.i}`,
            `SUM((1 - c.team) * c.value_${e.i}) AS control_${e.i}`,
            `SUM(c.team) AS exposures_${e.i}`,
            `MAX(c.has_event_${e.i}) AS has_event_${e.i}`,
          ]),
        ])}
      FROM __credited c
      GROUP BY c.user_id, c.ranking_id
    )`;

  // Per user, over engaged impressions only: impressions where at least one
  // row matching the metric's filters was credited. Gating on the summed value
  // would drop impressions whose values are negative or cancel out.
  const engaged = (i: number, expr: string) =>
    `SUM(${dialect.ifElse(`im.has_event_${i} = 1`, expr, "0")})`;
  // SQL Server keeps count and proportion values INT all the way here, and the
  // final SELECT squares them and sums across users (100k users x 150
  // exposures overflows INT). One cast per user makes every product below
  // floating point.
  const pairedUserCTE = `
    __pairedUser AS (
      SELECT
        ${cols([
          "im.user_id",
          ...plan.paired.flatMap((e) => [
            `${dialect.castToFloat(engaged(e.i, `im.treatment_${e.i}`))} AS treatment_${e.i}`,
            `${dialect.castToFloat(engaged(e.i, `im.control_${e.i}`))} AS control_${e.i}`,
            `${dialect.castToFloat(engaged(e.i, `im.exposures_${e.i}`))} AS exposures_${e.i}`,
          ]),
        ])}
      FROM __impression im
      GROUP BY im.user_id
    )`;

  // Preference chain

  // Fractional wins per user; a user x item with no engagement owns nothing
  const preferenceUserCTE = `
    __preferenceUser AS (
      SELECT
        ${cols([
          "s.user_id",
          ...plan.preference.flatMap((e) => [
            `SUM(COALESCE(ev.value_${e.i} * s.share_t, 0)) AS wins_t_${e.i}`,
            `SUM(COALESCE(ev.value_${e.i} * (1 - s.share_t), 0)) AS wins_c_${e.i}`,
          ]),
        ])}
      FROM __share s
      LEFT JOIN __preferenceEvents ev ON (
        ev.user_id = s.user_id AND ev.item_id = s.item_id
      )
      GROUP BY s.user_id
    )`;

  // Final

  const gate = (i: number, expr: string) =>
    `SUM(${dialect.ifElse(`pu.exposures_${i} > 0`, expr, "0")})`;
  const finalCols = [
    ...plan.paired.flatMap(({ i, out }) => [
      `${gate(i, "1")} AS ${out("users")}`,
      `${gate(i, `pu.treatment_${i}`)} AS ${out("treatment_sum")}`,
      `${gate(i, `pu.treatment_${i} * pu.treatment_${i}`)} AS ${out("treatment_sum_squares")}`,
      `${gate(i, `pu.control_${i}`)} AS ${out("control_sum")}`,
      `${gate(i, `pu.control_${i} * pu.control_${i}`)} AS ${out("control_sum_squares")}`,
      `${gate(i, `pu.exposures_${i}`)} AS ${out("exposures_sum")}`,
      `${gate(i, `pu.exposures_${i} * pu.exposures_${i}`)} AS ${out("exposures_sum_squares")}`,
      `${gate(i, `pu.treatment_${i} * pu.control_${i}`)} AS ${out("treatment_control_sum_product")}`,
      `${gate(i, `pu.treatment_${i} * pu.exposures_${i}`)} AS ${out("treatment_exposures_sum_product")}`,
      `${gate(i, `pu.control_${i} * pu.exposures_${i}`)} AS ${out("control_exposures_sum_product")}`,
    ]),
    ...plan.preference.flatMap(({ i, out }) => [
      `SUM(${dialect.ifElse(`pref.wins_t_${i} > pref.wins_c_${i}`, "1", "0")}) AS ${out("users_pref_treatment")}`,
      `SUM(${dialect.ifElse(`pref.wins_c_${i} > pref.wins_t_${i}`, "1", "0")}) AS ${out("users_pref_control")}`,
      `SUM(${dialect.ifElse(`pref.wins_t_${i} = pref.wins_c_${i}`, "1", "0")}) AS ${out("users_tied")}`,
    ]),
  ];

  const ctes = [
    exposuresCTE,
    ...(includePreference ? [shareCTE] : []),
    eventRowsCTE,
    ...(includePaired ? [eventsCTE] : []),
    ...(includePreference ? [preferenceEventsCTE] : []),
    ...(includePaired ? [creditedCTE, impressionCTE, pairedUserCTE] : []),
    ...(includePreference ? [preferenceUserCTE] : []),
  ].filter(Boolean);

  return format(
    `-- Interleaving metrics (one query per fact table)
    WITH ${ctes.join(",")}
    SELECT
      ${cols(["COUNT(*) AS users_exposed", ...finalCols])}
    FROM (SELECT DISTINCT user_id FROM __exposures) u
    ${includePaired ? "LEFT JOIN __pairedUser pu ON pu.user_id = u.user_id" : ""}
    ${includePreference ? "LEFT JOIN __preferenceUser pref ON pref.user_id = u.user_id" : ""}`,
    dialect.formatDialect,
  );
}
