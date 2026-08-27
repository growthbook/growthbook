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
 * Combined (fact table has an interleave_id column):
 *   one pass computes BOTH estimators' inputs plus interleave_id coverage:
 *   paired joint moments from impression-matched events (NULL ids never
 *   join), ownership preference counts from ALL events, and matched/total
 *   event counts. The runner picks the estimator by coverage
 *   (INTERLEAVING_PAIRED_COVERAGE_THRESHOLD).
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
    // Note: events are pre-aggregated per (user, impression, item) and the
    // join filters on MIN(timestamp) >= exposure timestamp. An item whose
    // FIRST event precedes the exposure is dropped entirely; an item with
    // both pre- and post-exposure events counts all of them. Exact per-event
    // filtering would need join-before-aggregate (fanout); acceptable v1
    // approximation since engagement follows exposure within an impression.
    const eventsCTE = `
    __events AS (
      SELECT
        m.${userIdType} AS user_id,
        m.${INTERLEAVING_INTERLEAVE_ID_COLUMN} AS interleave_id,
        m.${INTERLEAVING_ITEM_ID_COLUMN} AS item_id,
        ${metricType === "proportion" ? "1" : `SUM(${rawValueExpr})`} AS value,
        COUNT(*) AS event_count,
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
      `-- Interleaving metric: paired + ownership inputs and interleave_id
      -- coverage from one pass; the runner picks the estimator by coverage.
      -- __events is referenced three times, but it is already aggregated and
      -- multi-referenced CTEs are materialized on Postgres, so the fact
      -- table itself is scanned once.
    WITH
    ${exposuresCTE},
    ${eventsCTE},
    __eventsAll AS (
      -- Ownership input: engagement per user x item across ALL events,
      -- including those with a NULL interleave_id
      SELECT
        ev.user_id,
        ev.item_id,
        ${metricType === "proportion" ? "1" : "SUM(ev.value)"} AS value
      FROM __events ev
      GROUP BY ev.user_id, ev.item_id
    ),
    __credited AS (
      -- Paired input: NULL interleave_id events never satisfy this join
      SELECT
        e.user_id,
        e.interleave_id,
        e.item_id,
        e.team,
        COALESCE(ev.value, 0) AS value
      FROM __exposures e
      LEFT JOIN __events ev ON (
        ev.user_id = e.user_id
        AND ev.interleave_id = e.interleave_id
        AND ev.item_id = e.item_id
        AND ev.first_event_timestamp >= e.exposure_timestamp
      )
    ),
    __userItem AS (
      -- Engaged-impressions dilution filter (paired) via a window flag;
      -- ownership share from the same exposure rows
      SELECT
        t.user_id,
        t.item_id,
        SUM(t.team * t.value * t.eng) AS x_i,
        SUM((1 - t.team) * t.value * t.eng) AS y_i,
        SUM(t.team * t.eng) AS n_i,
        AVG(t.team * 1.0) AS share_t
      FROM (
        SELECT
          c.user_id,
          c.interleave_id,
          c.item_id,
          c.team,
          c.value,
          ${dialect.ifElse(
            `SUM(c.value) OVER (PARTITION BY c.user_id, c.interleave_id) > 0`,
            "1",
            "0",
          )} AS eng
        FROM __credited c
      ) t
      GROUP BY t.user_id, t.item_id
    ),
    __user AS (
      SELECT
        ui.user_id,
        SUM(ui.x_i) AS x,
        SUM(ui.y_i) AS y,
        SUM(ui.n_i) AS n,
        SUM(COALESCE(ea.value, 0) * ui.share_t) AS wins_t,
        SUM(COALESCE(ea.value, 0) * (1 - ui.share_t)) AS wins_c
      FROM __userItem ui
      LEFT JOIN __eventsAll ea ON (
        ea.user_id = ui.user_id AND ea.item_id = ui.item_id
      )
      GROUP BY ui.user_id
    )
    SELECT
      SUM(${dialect.ifElse("u.n > 0", "1", "0")}) AS users,
      SUM(${dialect.ifElse("u.n > 0", "u.x", "0")}) AS sum_x,
      SUM(${dialect.ifElse("u.n > 0", "u.x * u.x", "0")}) AS sum_xx,
      SUM(${dialect.ifElse("u.n > 0", "u.y", "0")}) AS sum_y,
      SUM(${dialect.ifElse("u.n > 0", "u.y * u.y", "0")}) AS sum_yy,
      SUM(${dialect.ifElse("u.n > 0", "u.n", "0")}) AS sum_n,
      SUM(${dialect.ifElse("u.n > 0", "u.n * u.n", "0")}) AS sum_nn,
      SUM(${dialect.ifElse("u.n > 0", "u.x * u.y", "0")}) AS sum_xy,
      SUM(${dialect.ifElse("u.n > 0", "u.x * u.n", "0")}) AS sum_xn,
      SUM(${dialect.ifElse("u.n > 0", "u.y * u.n", "0")}) AS sum_yn,
      COUNT(*) AS users_exposed,
      SUM(${dialect.ifElse("u.wins_t > u.wins_c", "1", "0")}) AS users_pref_treatment,
      SUM(${dialect.ifElse("u.wins_c > u.wins_t", "1", "0")}) AS users_pref_control,
      (SELECT COALESCE(SUM(ev.event_count), 0) FROM __events ev) AS events_total,
      (SELECT COALESCE(SUM(${dialect.ifElse(
        `ev.${INTERLEAVING_INTERLEAVE_ID_COLUMN} IS NOT NULL`,
        "ev.event_count",
        "0",
      )}), 0) FROM __events ev) AS events_matched
    FROM __user u`,
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
