import { buildMinimalOrCondition, format } from "shared/sql";
import {
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

/**
 * Sufficient-statistics query for interleaving experiments: one query per
 * fact table, covering every metric on that table and each analysis
 * requested on it. Output columns are prefixed m{i}_ by the metric's index
 * in `metrics`; paired and ownership column names do not collide.
 *
 * The exposure query returns ONE ROW PER IMPRESSION with the item detail in
 * an `items` JSON column (the SDK's nested exposure shape). __exposures
 * unnests it per warehouse dialect and groups to one row per
 * (user, ranking, competitive item), which also collapses SDK retries.
 *
 * Metric values use the experiment fact-metric resolution (numerator column
 * and row filters via getFactMetricColumn/getColumnRefWhereClause, per-unit
 * aggregation via getAggregationMetadata). __events is the single scan of
 * the fact table, at user x ranking x item grain when a paired analysis
 * needs the per-impression join, else user x item.
 *
 * Shared __exposures and __events feed two independent chains, each emitted
 * only when an analysis requests it, and joined per user at the end:
 * - "paired": __credited (exposures joined to engagement per impression x
 *   item via ranking_id; NULL ids never match) -> __impression (x, y, n per
 *   impression) -> __pairedUser (sums over engaged impressions only, where
 *   engaged means x + y > 0). n counts treatment-drafted competitive
 *   exposures; both x and y are normalized by it, which a fair team draft
 *   balances in expectation. The final SELECT emits cross-user joint moments
 *   for the paired delta-method t-test.
 * - "ownership": __share (per user x item treatment share over all
 *   competitive exposures, i.e. exposureCount attribution) joined to
 *   engagement per user x item (__events rolled up to that grain when it is
 *   at impression grain) -> __ownerUser (fractional win totals) -> user
 *   preference counts for the sign test.
 *
 * v1 limitations (documented): metric capping and conversion windows are
 * not applied; the snapshot date range bounds both exposures and engagement.
 * Impression joins filter on MIN(timestamp) >= exposure timestamp over rows
 * matching any metric's row filters: an item whose FIRST such event precedes
 * the exposure is dropped, one with mixed pre/post events counts all of them
 * — acceptable since engagement follows exposure within an impression.
 */

// One metric with the SQL fragments its CTEs need
type PlanEntry = {
  i: number;
  paired: boolean;
  ownership: boolean;
  // Aggregated metric value per group in __events
  value: string;
  // Re-aggregates per-impression values to user x item (__itemEvents)
  rollup: (column: string) => string;
};

type Plan = {
  entries: PlanEntry[];
  paired: PlanEntry[];
  ownership: PlanEntry[];
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
): Plan {
  const filterGroups: string[][] = [];

  const entries = metrics.map(({ analyses, metric }, i): PlanEntry => {
    const has: Record<InterleavingAnalysis["type"], boolean> = {
      paired: false,
      ownership: false,
    };
    for (const analysis of analyses) has[analysis.type] = true;
    const numerator = numeratorOf(metric);
    const filters = rowFilters(dialect, numerator, factTable);
    filterGroups.push(filters);
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
      ...has,
      value: agg.fullAggregationFunction(
        filters.length
          ? `CASE WHEN (${filters.join(" AND ")}) THEN ${rowValue} ELSE NULL END`
          : rowValue,
      ),
      rollup: agg.reAggregationFunction,
    };
  });

  return {
    entries,
    paired: entries.filter((e) => e.paired),
    ownership: entries.filter((e) => e.ownership),
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

  const plan = buildPlan(dialect, params.factTable, params.metrics);
  const includePaired = plan.paired.length > 0;
  const includeOwnership = plan.ownership.length > 0;

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

  // One row per (user, ranking, competitive item). Grouping collapses
  // double-logged impressions (SDK retries) and repeated items in a list.
  const itemId = item(INTERLEAVING_ITEM_FIELD_ITEM_ID);
  const exposuresCTE = `
    __exposures AS (
      SELECT
        ${cols([
          `e.${userIdType} AS user_id`,
          `e.${INTERLEAVING_RANKING_ID_COLUMN} AS ranking_id`,
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
      GROUP BY e.${userIdType}, e.${INTERLEAVING_RANKING_ID_COLUMN}, ${itemId}
    )`;

  // The single fact-table scan. Rows matching none of the metrics' row
  // filters are dropped. Grain is user x ranking x item when paired needs
  // the per-impression join, else user x item.
  const { factTable } = params;
  const eventUserId = getFactTableIdColumnExpression(
    factTable,
    userIdType,
    dialect,
    "m",
  );
  const eventTs = `m.${getFactTableTimestampColumn(factTable)}`;
  const eventKeys = [
    eventUserId,
    ...(includePaired ? [`m.${INTERLEAVING_RANKING_ID_COLUMN}`] : []),
    `m.${INTERLEAVING_ITEM_ID_COLUMN}`,
  ];
  const eventsWhere = [
    dateFilter(eventTs),
    buildMinimalOrCondition(plan.filterGroups),
  ]
    .filter(Boolean)
    .join("\n        AND ");
  const eventsCTE = `
    __events AS (
      SELECT
        ${cols([
          `${eventUserId} AS user_id`,
          ...(includePaired
            ? [`m.${INTERLEAVING_RANKING_ID_COLUMN} AS ranking_id`]
            : []),
          `m.${INTERLEAVING_ITEM_ID_COLUMN} AS item_id`,
          ...plan.entries.map((e) => `${e.value} AS value_${e.i}`),
          `MIN(${eventTs}) AS first_event_timestamp`,
        ])}
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
      WHERE ${eventsWhere}
      GROUP BY ${eventKeys.join(", ")}
    )`;

  // Paired chain

  // Every competitive exposure with the engagement on the same impression x
  // item at or after it (NULL ranking_id events never match). The timestamp
  // test lives in the value, not the ON, so the join stays an equi-join
  // (ClickHouse requires that; the join key yields at most one ev row).
  const afterExposure = dialect.ifElse(
    "ev.first_event_timestamp >= e.exposure_timestamp",
    "1",
    "0",
  );
  const creditedCTE = `
    __credited AS (
      SELECT
        ${cols([
          "e.user_id",
          "e.ranking_id",
          "e.team",
          ...plan.paired.map(
            (e) =>
              `COALESCE(ev.value_${e.i} * ${afterExposure}, 0) AS value_${e.i}`,
          ),
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
          ]),
        ])}
      FROM __credited c
      GROUP BY c.user_id, c.ranking_id
    )`;

  // Per user, over engaged impressions only (any engagement on the metric)
  const engaged = (i: number, expr: string) =>
    `SUM(${dialect.ifElse(`im.treatment_${i} + im.control_${i} > 0`, expr, "0")})`;
  const pairedUserCTE = `
    __pairedUser AS (
      SELECT
        ${cols([
          "im.user_id",
          ...plan.paired.flatMap((e) => [
            `${engaged(e.i, `im.treatment_${e.i}`)} AS treatment_${e.i}`,
            `${engaged(e.i, `im.control_${e.i}`)} AS control_${e.i}`,
            `${engaged(e.i, `im.exposures_${e.i}`)} AS exposures_${e.i}`,
          ]),
        ])}
      FROM __impression im
      GROUP BY im.user_id
    )`;

  // Ownership chain

  // Engagement per user x item across ALL events. __events is already at
  // that grain unless paired put it at impression grain, then roll it up.
  const itemEventsCTE = includePaired
    ? `
    __itemEvents AS (
      SELECT
        ${cols([
          "ev.user_id",
          "ev.item_id",
          ...plan.ownership.map(
            (e) => `${e.rollup(`ev.value_${e.i}`)} AS value_${e.i}`,
          ),
        ])}
      FROM __events ev
      GROUP BY ev.user_id, ev.item_id
    )`
    : "";
  const itemEvents = includePaired ? "__itemEvents" : "__events";

  // Treatment share of each user's competitive exposures to an item
  const shareCTE = `
    __share AS (
      SELECT
        e.user_id,
        e.item_id,
        AVG(e.team * 1.0) AS share_t
      FROM __exposures e
      GROUP BY e.user_id, e.item_id
    )`;

  // Fractional wins per user; a user x item with no engagement owns nothing
  const ownerUserCTE = `
    __ownerUser AS (
      SELECT
        ${cols([
          "s.user_id",
          ...plan.ownership.flatMap((e) => [
            `SUM(COALESCE(ev.value_${e.i} * s.share_t, 0)) AS wins_t_${e.i}`,
            `SUM(COALESCE(ev.value_${e.i} * (1 - s.share_t), 0)) AS wins_c_${e.i}`,
          ]),
        ])}
      FROM __share s
      LEFT JOIN ${itemEvents} ev ON (
        ev.user_id = s.user_id AND ev.item_id = s.item_id
      )
      GROUP BY s.user_id
    )`;

  // Final

  const gate = (i: number, expr: string) =>
    `SUM(${dialect.ifElse(`pu.exposures_${i} > 0`, expr, "0")})`;
  const finalCols = [
    ...plan.paired.flatMap(({ i }) => [
      `${gate(i, "1")} AS m${i}_users`,
      `${gate(i, `pu.treatment_${i}`)} AS m${i}_treatment_sum`,
      `${gate(i, `pu.treatment_${i} * pu.treatment_${i}`)} AS m${i}_treatment_sum_squares`,
      `${gate(i, `pu.control_${i}`)} AS m${i}_control_sum`,
      `${gate(i, `pu.control_${i} * pu.control_${i}`)} AS m${i}_control_sum_squares`,
      `${gate(i, `pu.exposures_${i}`)} AS m${i}_exposures_sum`,
      `${gate(i, `pu.exposures_${i} * pu.exposures_${i}`)} AS m${i}_exposures_sum_squares`,
      `${gate(i, `pu.treatment_${i} * pu.control_${i}`)} AS m${i}_treatment_control_sum_product`,
      `${gate(i, `pu.treatment_${i} * pu.exposures_${i}`)} AS m${i}_treatment_exposures_sum_product`,
      `${gate(i, `pu.control_${i} * pu.exposures_${i}`)} AS m${i}_control_exposures_sum_product`,
    ]),
    ...plan.ownership.flatMap(({ i }) => [
      `SUM(${dialect.ifElse(`ou.wins_t_${i} > ou.wins_c_${i}`, "1", "0")}) AS m${i}_users_pref_treatment`,
      `SUM(${dialect.ifElse(`ou.wins_c_${i} > ou.wins_t_${i}`, "1", "0")}) AS m${i}_users_pref_control`,
      `SUM(${dialect.ifElse(`ou.wins_t_${i} = ou.wins_c_${i}`, "1", "0")}) AS m${i}_users_tied`,
    ]),
  ];

  const ctes = [
    exposuresCTE,
    eventsCTE,
    ...(includePaired ? [creditedCTE, impressionCTE, pairedUserCTE] : []),
    ...(includeOwnership ? [itemEventsCTE, shareCTE, ownerUserCTE] : []),
  ].filter(Boolean);

  return format(
    `-- Interleaving metrics (one query per fact table)
    WITH ${ctes.join(",")}
    SELECT
      ${cols(["COUNT(*) AS users_exposed", ...finalCols])}
    FROM (SELECT DISTINCT user_id FROM __exposures) u
    ${includePaired ? "LEFT JOIN __pairedUser pu ON pu.user_id = u.user_id" : ""}
    ${includeOwnership ? "LEFT JOIN __ownerUser ou ON ou.user_id = u.user_id" : ""}`,
    dialect.formatDialect,
  );
}
