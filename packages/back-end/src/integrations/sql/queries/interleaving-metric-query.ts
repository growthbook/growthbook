import { format } from "shared/sql";
import {
  INTERLEAVING_EXPERIMENT_ID_COLUMN,
  INTERLEAVING_INTERLEAVE_ID_COLUMN,
  INTERLEAVING_ITEM_FIELD_COMPETITIVE,
  INTERLEAVING_ITEM_FIELD_ITEM_ID,
  INTERLEAVING_ITEM_FIELD_VARIATION,
  INTERLEAVING_ITEM_ID_COLUMN,
  INTERLEAVING_ITEMS_COLUMN,
  INTERLEAVING_TIMESTAMP_COLUMN,
  isSignalAnalysis,
} from "shared/validators";
import type {
  InterleavingMetricQueryMetric,
  InterleavingMetricQueryParams,
} from "shared/types/integrations";
import type { SqlDialect } from "shared/types/sql";
import { compileSqlTemplate } from "back-end/src/util/sql";

/**
 * Sufficient-statistics query for interleaving experiments: one query per
 * fact table, covering every (metric, analysis) pair on that table. Output
 * columns are prefixed m{i}_ by the pair's index in `metrics`.
 *
 * The exposure query returns ONE ROW PER IMPRESSION with the item detail in
 * an `items` JSON column (the SDK's nested exposure shape); the __exposures
 * CTE unnests it per warehouse dialect.
 *
 * - "paired": engagement joined per impression x item via interleave_id
 *   (NULL ids never satisfy the join) -> per-user (x, y, n) restricted to
 *   engaged impressions -> cross-user joint moments for the paired
 *   delta-method t-test;
 * - "ownership": per user x item treatment share -> fractional win totals
 *   over ALL engagement events -> user preference counts for the sign test.
 *   The share is over all competitive exposures (exposureCount), or only the
 *   exposures whose impression received a signal event (engagementSignal;
 *   one __signalShare CTE per distinct signal metric).
 * Each CTE branch is only emitted when at least one analysis requests it.
 *
 * v1 limitations (documented): metric capping, conversion windows, and row
 * filters are not applied; the snapshot date range bounds both exposures and
 * engagement. Impression joins filter on MIN(timestamp) >= exposure
 * timestamp: an item whose FIRST event precedes the exposure is dropped, one
 * with mixed pre/post events counts all of them — acceptable since
 * engagement follows exposure within an impression.
 */

function sqlStringLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

// One (metric, analysis) pair with the SQL fragments its CTEs need
type PlanEntry = {
  i: number;
  metric: InterleavingMetricQueryMetric;
  // Per-row metric value inside an aggregate over the fact table
  value: string;
  // Ownership only: treatment share at user x item grain in __user
  share?: string;
};

type Plan = {
  entries: PlanEntry[];
  paired: PlanEntry[];
  ownership: PlanEntry[];
  // Fact table SQL per signal, indexed by the j in __signalShare_{j}
  signalSql: string[];
};

function buildPlan(
  metrics: InterleavingMetricQueryMetric[],
  signals: InterleavingMetricQueryParams["signals"],
): Plan {
  const signalSqlById = new Map(signals.map((s) => [s.id, s.factTableSql]));
  const signalIndex = new Map<string, number>();
  const signalSql: string[] = [];
  const entries = metrics.map((metric, i): PlanEntry => {
    const value =
      metric.metricType === "proportion" || !metric.valueColumn
        ? "1"
        : `SUM(m.${metric.valueColumn})`;
    const { analysis } = metric;
    if (analysis.type === "paired") return { i, metric, value };
    if (!isSignalAnalysis(analysis)) {
      return { i, metric, value, share: "ui.share_t" };
    }
    const id = analysis.signalMetricId;
    const sql = signalSqlById.get(id);
    if (sql === undefined) {
      throw new Error(`Missing fact table SQL for signal metric ${id}`);
    }
    let j = signalIndex.get(id);
    if (j === undefined) {
      j = signalSql.push(sql) - 1;
      signalIndex.set(id, j);
    }
    return { i, metric, value, share: `ss_${j}.share_t` };
  });
  return {
    entries,
    paired: entries.filter((e) => e.metric.analysis.type === "paired"),
    ownership: entries.filter((e) => e.metric.analysis.type === "ownership"),
    signalSql,
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

  const plan = buildPlan(params.metrics, params.signals);
  const includePaired = plan.paired.length > 0;
  const includeOwnership = plan.ownership.length > 0;
  // Paired credit and signal shares both join per impression
  const includeInterleaveId = includePaired || plan.signalSql.length > 0;

  const compiled = {
    startDate,
    endDate: endDate ?? undefined,
    experimentId: trackingKey,
  };
  const [controlKey, treatmentKey] = variationKeys;
  const ts = INTERLEAVING_TIMESTAMP_COLUMN;
  const dateFilter = (col: string) =>
    `${col} >= ${dialect.toTimestamp(startDate)}` +
    (endDate ? ` AND ${col} <= ${dialect.toTimestamp(endDate)}` : "");
  const item = (field: string) => jsonArray.fieldText("item", field);
  const cols = (parts: string[]) => parts.join(",\n        ");

  // 1 for treatment picks, 0 for control picks; other variation values dropped
  const teamExpr = dialect.ifElse(
    `${item(INTERLEAVING_ITEM_FIELD_VARIATION)} = ${sqlStringLiteral(treatmentKey)}`,
    "1",
    "0",
  );

  const exposuresCTE = `
    __exposures AS (
      SELECT
        ${cols([
          `e.${userIdType} AS user_id`,
          ...(includeInterleaveId
            ? [`e.${INTERLEAVING_INTERLEAVE_ID_COLUMN} AS interleave_id`]
            : []),
          `${item(INTERLEAVING_ITEM_FIELD_ITEM_ID)} AS item_id`,
          `${teamExpr} AS team`,
          `e.${ts} AS exposure_timestamp`,
        ])}
      FROM (
        ${compileSqlTemplate(params.exposureQuery, compiled)}
      ) e
      ${jsonArray.unnest(`e.${INTERLEAVING_ITEMS_COLUMN}`, "item")}
      WHERE e.${INTERLEAVING_EXPERIMENT_ID_COLUMN} = ${sqlStringLiteral(trackingKey)}
        AND ${item(INTERLEAVING_ITEM_FIELD_COMPETITIVE)} = 'true'
        AND ${item(INTERLEAVING_ITEM_FIELD_VARIATION)} IN (${sqlStringLiteral(controlKey)}, ${sqlStringLiteral(treatmentKey)})
        AND ${dateFilter(`e.${ts}`)}
    )`;

  // Events from a fact table at user x item grain, or user x impression x
  // item when they'll be joined to exposures per impression
  const eventsCTE = (
    alias: string,
    sql: string,
    perImpression: boolean,
    values: PlanEntry[],
  ) => {
    const keys = [
      `m.${userIdType}`,
      ...(perImpression ? [`m.${INTERLEAVING_INTERLEAVE_ID_COLUMN}`] : []),
      `m.${INTERLEAVING_ITEM_ID_COLUMN}`,
    ];
    return `
    ${alias} AS (
      SELECT
        ${cols([
          `m.${userIdType} AS user_id`,
          ...(perImpression
            ? [`m.${INTERLEAVING_INTERLEAVE_ID_COLUMN} AS interleave_id`]
            : []),
          `m.${INTERLEAVING_ITEM_ID_COLUMN} AS item_id`,
          ...values.map((e) => `${e.value} AS value_${e.i}`),
          `MIN(m.timestamp) AS first_event_timestamp`,
        ])}
      FROM (
        ${compileSqlTemplate(sql, compiled)}
      ) m
      WHERE ${dateFilter("m.timestamp")}
      GROUP BY ${keys.join(", ")}
    )`;
  };

  // Events on the same impression x item as exposure row `e`, at or after
  // it. NULL interleave_id events never match.
  const impressionJoin = (ev: string) => `ON (
        ${ev}.user_id = e.user_id
        AND ${ev}.interleave_id = e.interleave_id
        AND ${ev}.item_id = e.item_id
        AND ${ev}.first_event_timestamp >= e.exposure_timestamp
      )`;

  // Treatment share over the exposures whose impression received the signal
  const signalCTEs = plan.signalSql.flatMap((sql, j) => [
    eventsCTE(`__signalEvents_${j}`, sql, true, []),
    `
    __signalShare_${j} AS (
      SELECT
        e.user_id,
        e.item_id,
        AVG(e.team * 1.0) AS share_t
      FROM __exposures e
      JOIN __signalEvents_${j} s ${impressionJoin("s")}
      GROUP BY e.user_id, e.item_id
    )`,
  ]);

  // Ownership input: engagement per user x item across ALL events. When
  // __events is at impression grain (paired present) roll it up.
  const rollupEvents = includePaired && includeOwnership;
  const eventsAllCTE = rollupEvents
    ? `
    __eventsAll AS (
      SELECT
        ${cols([
          "ev.user_id",
          "ev.item_id",
          ...plan.ownership.map(
            (e) =>
              `${e.metric.metricType === "proportion" ? "1" : `SUM(ev.value_${e.i})`} AS value_${e.i}`,
          ),
        ])}
      FROM __events ev
      GROUP BY ev.user_id, ev.item_id
    )`
    : "";
  const eventsAllName = rollupEvents ? "__eventsAll" : "__events";

  // Paired input: every competitive exposure with its credited metric values
  const creditedCTE = includePaired
    ? `
    __credited AS (
      SELECT
        ${cols([
          "e.user_id",
          "e.interleave_id",
          "e.item_id",
          "e.team",
          ...plan.paired.map(
            (e) => `COALESCE(ev.value_${e.i}, 0) AS value_${e.i}`,
          ),
        ])}
      FROM __exposures e
      LEFT JOIN __events ev ${impressionJoin("ev")}
    )`
    : "";

  // user x item grain: paired engaged-gated sums (per metric) and the
  // exposure-count share, all from one pass over the exposure rows
  const userItemCTE = includePaired
    ? `
    __userItem AS (
      SELECT
        ${cols([
          "t.user_id",
          "t.item_id",
          ...plan.paired.flatMap((e) => [
            `SUM(t.team * t.value_${e.i} * t.eng_${e.i}) AS x_${e.i}`,
            `SUM((1 - t.team) * t.value_${e.i} * t.eng_${e.i}) AS y_${e.i}`,
            `SUM(t.team * t.eng_${e.i}) AS n_${e.i}`,
          ]),
          "AVG(t.team * 1.0) AS share_t",
        ])}
      FROM (
        SELECT
          ${cols([
            "c.*",
            ...plan.paired.map(
              (e) =>
                `${dialect.ifElse(
                  `SUM(c.value_${e.i}) OVER (PARTITION BY c.user_id, c.interleave_id) > 0`,
                  "1",
                  "0",
                )} AS eng_${e.i}`,
            ),
          ])}
        FROM __credited c
      ) t
      GROUP BY t.user_id, t.item_id
    )`
    : `
    __userItem AS (
      SELECT
        e.user_id,
        e.item_id,
        AVG(e.team * 1.0) AS share_t
      FROM __exposures e
      GROUP BY e.user_id, e.item_id
    )`;

  // A user x item with no share (no signaled exposure) owns nothing: both 0
  const userCTE = `
    __user AS (
      SELECT
        ${cols([
          "ui.user_id",
          ...plan.paired.flatMap((e) => [
            `SUM(ui.x_${e.i}) AS x_${e.i}`,
            `SUM(ui.y_${e.i}) AS y_${e.i}`,
            `SUM(ui.n_${e.i}) AS n_${e.i}`,
          ]),
          ...plan.ownership.flatMap((e) => [
            `SUM(COALESCE(ea.value_${e.i} * ${e.share}, 0)) AS wins_t_${e.i}`,
            `SUM(COALESCE(ea.value_${e.i} * (1 - ${e.share}), 0)) AS wins_c_${e.i}`,
          ]),
        ])}
      FROM __userItem ui
      ${
        includeOwnership
          ? `LEFT JOIN ${eventsAllName} ea ON (
        ea.user_id = ui.user_id AND ea.item_id = ui.item_id
      )`
          : ""
      }
      ${plan.signalSql
        .map(
          (_, j) => `LEFT JOIN __signalShare_${j} ss_${j} ON (
        ss_${j}.user_id = ui.user_id AND ss_${j}.item_id = ui.item_id
      )`,
        )
        .join("\n      ")}
      GROUP BY ui.user_id
    )`;

  const gate = (i: number, expr: string) =>
    `SUM(${dialect.ifElse(`u.n_${i} > 0`, expr, "0")})`;
  const finalCols = plan.entries.flatMap(({ i, metric }) => {
    switch (metric.analysis.type) {
      case "paired":
        return [
          `${gate(i, "1")} AS m${i}_users`,
          `${gate(i, `u.x_${i}`)} AS m${i}_sum_x`,
          `${gate(i, `u.x_${i} * u.x_${i}`)} AS m${i}_sum_xx`,
          `${gate(i, `u.y_${i}`)} AS m${i}_sum_y`,
          `${gate(i, `u.y_${i} * u.y_${i}`)} AS m${i}_sum_yy`,
          `${gate(i, `u.n_${i}`)} AS m${i}_sum_n`,
          `${gate(i, `u.n_${i} * u.n_${i}`)} AS m${i}_sum_nn`,
          `${gate(i, `u.x_${i} * u.y_${i}`)} AS m${i}_sum_xy`,
          `${gate(i, `u.x_${i} * u.n_${i}`)} AS m${i}_sum_xn`,
          `${gate(i, `u.y_${i} * u.n_${i}`)} AS m${i}_sum_yn`,
        ];
      case "ownership":
        return [
          `SUM(${dialect.ifElse(`u.wins_t_${i} > u.wins_c_${i}`, "1", "0")}) AS m${i}_users_pref_treatment`,
          `SUM(${dialect.ifElse(`u.wins_c_${i} > u.wins_t_${i}`, "1", "0")}) AS m${i}_users_pref_control`,
        ];
      default: {
        const unknown: never = metric.analysis;
        throw new Error(`Unknown analysis: ${JSON.stringify(unknown)}`);
      }
    }
  });

  const ctes = [
    exposuresCTE,
    eventsCTE("__events", params.factTableSql, includePaired, plan.entries),
    ...signalCTEs,
    eventsAllCTE,
    creditedCTE,
    userItemCTE,
    userCTE,
  ].filter(Boolean);

  return format(
    `-- Interleaving metrics (one query per fact table)
    WITH ${ctes.join(",")}
    SELECT
      ${cols(["COUNT(*) AS users_exposed", ...finalCols])}
    FROM __user u`,
    dialect.formatDialect,
  );
}
