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
} from "shared/validators";
import type { InterleavingMetricQueryParams } from "shared/types/integrations";
import type { SqlDialect } from "shared/types/sql";
import { compileSqlTemplate } from "back-end/src/util/sql";

/**
 * Per-metric sufficient-statistics queries for interleaving experiments.
 *
 * The exposure query returns ONE ROW PER IMPRESSION with the item detail in
 * an `items` JSON column (the SDK's nested exposure shape); the __exposures
 * CTE unnests it per warehouse dialect.
 *
 * Paired (interleave_id joinable):
 *   exposures (competitive picks) -> engagement joined per impression x item
 *   -> per-user (x, y, n) restricted to engaged impressions -> one row of
 *   cross-user joint moments for the paired delta-method t-test.
 *
 * Ownership (no interleave_id):
 *   per user x item ownership share across all competitive exposures ->
 *   engagement joined per user x item -> per-user fractional win totals ->
 *   one row of user preference counts for the sign test.
 *
 * v1 limitations (documented): metric capping, conversion windows, and row
 * filters are not applied; the snapshot date range bounds both exposures and
 * engagement, and engagement must not precede the exposure (paired only).
 */

function sqlStringLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function getInterleavingMetricQuery(
  dialect: SqlDialect,
  params: InterleavingMetricQueryParams,
): string {
  const {
    estimator,
    userIdType,
    trackingKey,
    variationNames,
    startDate,
    endDate,
    metricType,
    valueColumn,
  } = params;

  const [controlName, treatmentName] = variationNames;

  const compiled = {
    startDate,
    endDate: endDate ?? undefined,
    experimentId: trackingKey,
  };
  const exposureSql = compileSqlTemplate(params.exposureQuery, compiled);
  const factSql = compileSqlTemplate(params.factTableSql, compiled);

  const ts = INTERLEAVING_TIMESTAMP_COLUMN;
  const dateFilter = (col: string) =>
    `${col} >= ${dialect.toTimestamp(startDate)}` +
    (endDate ? ` AND ${col} <= ${dialect.toTimestamp(endDate)}` : "");

  if (!dialect.unnestJsonArray || !dialect.jsonArrayFieldText) {
    throw new Error(
      "Interleaving analysis is not supported for this Data Source type yet",
    );
  }
  const item = (field: string) => dialect.jsonArrayFieldText!("item", field);

  // 1 for treatment picks, 0 for control picks; other variation values dropped
  const teamExpr = `${dialect.ifElse(
    `${item(INTERLEAVING_ITEM_FIELD_VARIATION)} = ${sqlStringLiteral(treatmentName)}`,
    "1",
    "0",
  )}`;

  const exposuresCTE = `
    __exposures AS (
      SELECT
        e.${userIdType} AS user_id,
        ${estimator === "paired" ? `e.${INTERLEAVING_INTERLEAVE_ID_COLUMN} AS interleave_id,` : ""}
        ${item(INTERLEAVING_ITEM_FIELD_ITEM_ID)} AS item_id,
        ${teamExpr} AS team,
        e.${ts} AS exposure_timestamp
      FROM (
        ${exposureSql}
      ) e
      ${dialect.unnestJsonArray(`e.${INTERLEAVING_ITEMS_COLUMN}`, "item")}
      WHERE e.${INTERLEAVING_EXPERIMENT_ID_COLUMN} = ${sqlStringLiteral(trackingKey)}
        AND ${item(INTERLEAVING_ITEM_FIELD_COMPETITIVE)} = 'true'
        AND ${item(INTERLEAVING_ITEM_FIELD_VARIATION)} IN (${sqlStringLiteral(controlName)}, ${sqlStringLiteral(treatmentName)})
        AND ${dateFilter(`e.${ts}`)}
    )`;

  // For proportion metrics engagement is existence (value 1); for mean
  // metrics it is the numerator column summed across events
  const rawValueExpr =
    metricType === "proportion" || !valueColumn ? "1" : `m.${valueColumn}`;

  if (estimator === "paired") {
    const eventsCTE = `
    __events AS (
      SELECT
        m.${userIdType} AS user_id,
        m.${INTERLEAVING_INTERLEAVE_ID_COLUMN} AS interleave_id,
        m.${INTERLEAVING_ITEM_ID_COLUMN} AS item_id,
        ${metricType === "proportion" ? "1" : `SUM(${rawValueExpr})`} AS value,
        MIN(m.timestamp) AS first_event_timestamp
      FROM (
        ${factSql}
      ) m
      WHERE ${dateFilter("m.timestamp")}
      GROUP BY
        m.${userIdType},
        m.${INTERLEAVING_INTERLEAVE_ID_COLUMN},
        m.${INTERLEAVING_ITEM_ID_COLUMN}
    )`;

    return format(
      `-- Interleaving metric (paired estimator)
    WITH
    ${exposuresCTE},
    ${eventsCTE},
    __engagedImpressions AS (
      SELECT DISTINCT e.user_id, e.interleave_id
      FROM __exposures e
      JOIN __events ev ON (
        ev.user_id = e.user_id
        AND ev.interleave_id = e.interleave_id
        AND ev.item_id = e.item_id
        AND ev.first_event_timestamp >= e.exposure_timestamp
      )
    ),
    __userStats AS (
      SELECT
        e.user_id,
        SUM(e.team * COALESCE(ev.value, 0)) AS x,
        SUM((1 - e.team) * COALESCE(ev.value, 0)) AS y,
        SUM(e.team) AS n
      FROM __exposures e
      JOIN __engagedImpressions g ON (
        g.user_id = e.user_id AND g.interleave_id = e.interleave_id
      )
      LEFT JOIN __events ev ON (
        ev.user_id = e.user_id
        AND ev.interleave_id = e.interleave_id
        AND ev.item_id = e.item_id
        AND ev.first_event_timestamp >= e.exposure_timestamp
      )
      GROUP BY e.user_id
    )
    SELECT
      COUNT(*) AS users,
      SUM(u.x) AS sum_x,
      SUM(u.x * u.x) AS sum_xx,
      SUM(u.y) AS sum_y,
      SUM(u.y * u.y) AS sum_yy,
      SUM(u.n) AS sum_n,
      SUM(u.n * u.n) AS sum_nn,
      SUM(u.x * u.y) AS sum_xy,
      SUM(u.x * u.n) AS sum_xn,
      SUM(u.y * u.n) AS sum_yn
    FROM __userStats u
    WHERE u.n > 0`,
      dialect.formatDialect,
    );
  }

  // Ownership estimator
  return format(
    `-- Interleaving metric (ownership estimator)
    WITH
    ${exposuresCTE},
    __ownership AS (
      SELECT
        e.user_id,
        e.item_id,
        AVG(e.team * 1.0) AS share_t
      FROM __exposures e
      GROUP BY e.user_id, e.item_id
    ),
    __events AS (
      SELECT
        m.${userIdType} AS user_id,
        m.${INTERLEAVING_ITEM_ID_COLUMN} AS item_id,
        ${metricType === "proportion" ? "1" : `SUM(${rawValueExpr})`} AS value
      FROM (
        ${factSql}
      ) m
      WHERE ${dateFilter("m.timestamp")}
      GROUP BY m.${userIdType}, m.${INTERLEAVING_ITEM_ID_COLUMN}
    ),
    __userWins AS (
      SELECT
        o.user_id,
        SUM(ev.value * o.share_t) AS wins_t,
        SUM(ev.value * (1 - o.share_t)) AS wins_c
      FROM __ownership o
      JOIN __events ev ON (
        ev.user_id = o.user_id AND ev.item_id = o.item_id
      )
      GROUP BY o.user_id
    )
    SELECT
      (SELECT COUNT(DISTINCT e2.user_id) FROM __exposures e2) AS users_exposed,
      SUM(${dialect.ifElse("w.wins_t > w.wins_c", "1", "0")}) AS users_pref_treatment,
      SUM(${dialect.ifElse("w.wins_c > w.wins_t", "1", "0")}) AS users_pref_control
    FROM __userWins w`,
    dialect.formatDialect,
  );
}
