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
import type { InterleavingAnalysis } from "shared/validators";
import type { InterleavingMetricQueryParams } from "shared/types/integrations";
import type { SqlDialect } from "shared/types/sql";
import { compileSqlTemplate } from "back-end/src/util/sql";

/**
 * Sufficient-statistics query for interleaving experiments: one query per
 * fact table, covering every selected metric on that table (output columns
 * prefixed m{i}_ by metric index).
 *
 * The exposure query returns ONE ROW PER IMPRESSION with the item detail in
 * an `items` JSON column (the SDK's nested exposure shape); the __exposures
 * CTE unnests it per warehouse dialect.
 *
 * Each entry in `metrics` is one (metric, analysis) pair:
 * - "paired": engagement joined per impression x item via interleave_id
 *   (NULL ids never satisfy the join) -> per-user (x, y, n) restricted to
 *   engaged impressions -> cross-user joint moments for the paired
 *   delta-method t-test;
 * - "ownership" by exposure count: per user x item ownership shares across
 *   all competitive exposures -> fractional win totals over ALL engagement
 *   events -> user preference counts for the sign test;
 * - "ownership" by engagement signal: same, but the share is taken over only
 *   the exposures whose impression received a signal event (e.g. a click),
 *   joined per impression x item via interleave_id. One share CTE per
 *   distinct signal metric.
 * Each CTE branch is only emitted when at least one analysis requests it.
 *
 * v1 limitations (documented): metric capping, conversion windows, and row
 * filters are not applied; the snapshot date range bounds both exposures and
 * engagement. Paired attribution pre-aggregates events per (user,
 * impression, item) and filters on MIN(timestamp) >= exposure timestamp: an
 * item whose FIRST event precedes the exposure is dropped, one with mixed
 * pre/post events counts all of them — acceptable since engagement follows
 * exposure within an impression.
 */

function sqlStringLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

// "ownership" and "signal" share output columns; they differ in how the
// per user x item share is computed.
export type SqlAnalysisKind = "paired" | "ownership" | "signal";

// Which CTE branch an analysis needs.
export function sqlAnalysisKind(a: InterleavingAnalysis): SqlAnalysisKind {
  if (a.type === "paired") return "paired";
  switch (a.attribution) {
    case "exposureCount":
      return "ownership";
    case "engagementSignal":
      return "signal";
    default: {
      const unknown: never = a;
      throw new Error(
        `Unknown ownership attribution: ${JSON.stringify(unknown)}`,
      );
    }
  }
}

export function getInterleavingMetricQuery(
  dialect: SqlDialect,
  params: InterleavingMetricQueryParams,
): string {
  const {
    userIdType,
    trackingKey,
    variationKeys,
    startDate,
    endDate,
    metrics,
    signals,
  } = params;

  if (metrics.length === 0) {
    throw new Error("Interleaving metric query requires at least one metric");
  }
  const { jsonArray } = dialect;
  if (!jsonArray) {
    throw new Error(
      "Interleaving analysis is not supported for this Data Source type yet",
    );
  }

  const [controlKey, treatmentKey] = variationKeys;
  const kinds = metrics.map((m) => sqlAnalysisKind(m.analysis));
  const pairedIdx = kinds.flatMap((k, i) => (k === "paired" ? [i] : []));
  // Exposure-count and signal ownership both consume per user x item events
  const ownershipIdx = kinds.flatMap((k, i) =>
    k === "ownership" || k === "signal" ? [i] : [],
  );
  const includePaired = pairedIdx.length > 0;
  const includeOwnership = ownershipIdx.length > 0;

  // Signal j (index into `signals`) for each signal analysis; signals are
  // shared across analyses that use the same signal metric
  const signalIdOf = (i: number): string => {
    const a = metrics[i].analysis;
    if (a.type !== "ownership" || a.attribution !== "engagementSignal") {
      throw new Error(`Metric ${i} is not an engagement signal analysis`);
    }
    return a.signalMetricId;
  };
  const signalJ: Record<number, number> = {};
  kinds.forEach((k, i) => {
    if (k !== "signal") return;
    const j = signals.findIndex((s) => s.id === signalIdOf(i));
    if (j < 0) {
      throw new Error(
        `Missing fact table SQL for signal metric ${signalIdOf(i)}`,
      );
    }
    signalJ[i] = j;
  });
  const usedSignals = [...new Set(Object.values(signalJ))].sort();
  // Both paired credit and signal shares join per impression
  const includeInterleaveId = includePaired || usedSignals.length > 0;

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
  const item = (field: string) => jsonArray.fieldText("item", field);

  const valueExpr = (i: number) =>
    metrics[i].metricType === "proportion" || !metrics[i].valueColumn
      ? "1"
      : `SUM(m.${metrics[i].valueColumn})`;

  // 1 for treatment picks, 0 for control picks; other variation values dropped
  const teamExpr = `${dialect.ifElse(
    `${item(INTERLEAVING_ITEM_FIELD_VARIATION)} = ${sqlStringLiteral(treatmentKey)}`,
    "1",
    "0",
  )}`;

  const exposuresCTE = `
    __exposures AS (
      SELECT
        e.${userIdType} AS user_id,
        ${includeInterleaveId ? `e.${INTERLEAVING_INTERLEAVE_ID_COLUMN} AS interleave_id,` : ""}
        ${item(INTERLEAVING_ITEM_FIELD_ITEM_ID)} AS item_id,
        ${teamExpr} AS team,
        e.${ts} AS exposure_timestamp
      FROM (
        ${exposureSql}
      ) e
      ${jsonArray.unnest(`e.${INTERLEAVING_ITEMS_COLUMN}`, "item")}
      WHERE e.${INTERLEAVING_EXPERIMENT_ID_COLUMN} = ${sqlStringLiteral(trackingKey)}
        AND ${item(INTERLEAVING_ITEM_FIELD_COMPETITIVE)} = 'true'
        AND ${item(INTERLEAVING_ITEM_FIELD_VARIATION)} IN (${sqlStringLiteral(controlKey)}, ${sqlStringLiteral(treatmentKey)})
        AND ${dateFilter(`e.${ts}`)}
    )`;

  // Engagement grain: per impression x item when paired credit is needed,
  // per user x item otherwise
  const eventsCTE = `
    __events AS (
      SELECT
        m.${userIdType} AS user_id,
        ${includePaired ? `m.${INTERLEAVING_INTERLEAVE_ID_COLUMN} AS interleave_id,` : ""}
        m.${INTERLEAVING_ITEM_ID_COLUMN} AS item_id,
        ${metrics.map((_, i) => `${valueExpr(i)} AS value_${i},`).join("\n        ")}
        MIN(m.timestamp) AS first_event_timestamp
      FROM (
        ${factSql}
      ) m
      WHERE ${dateFilter("m.timestamp")}
      GROUP BY
        m.${userIdType},
        ${includePaired ? `m.${INTERLEAVING_INTERLEAVE_ID_COLUMN},` : ""}
        m.${INTERLEAVING_ITEM_ID_COLUMN}
    )`;

  // Signal shares: ranker share over exposures whose impression received the
  // signal event for that item (NULL interleave_id events never join)
  const signalCTEs = usedSignals
    .map(
      (j) => `,
    __signalEvents_${j} AS (
      SELECT
        s.${userIdType} AS user_id,
        s.${INTERLEAVING_INTERLEAVE_ID_COLUMN} AS interleave_id,
        s.${INTERLEAVING_ITEM_ID_COLUMN} AS item_id,
        MIN(s.timestamp) AS first_event_timestamp
      FROM (
        ${compileSqlTemplate(signals[j].factTableSql, compiled)}
      ) s
      WHERE ${dateFilter("s.timestamp")}
      GROUP BY
        s.${userIdType},
        s.${INTERLEAVING_INTERLEAVE_ID_COLUMN},
        s.${INTERLEAVING_ITEM_ID_COLUMN}
    ),
    __signalShare_${j} AS (
      SELECT
        e.user_id,
        e.item_id,
        AVG(e.team * 1.0) AS share_t
      FROM __exposures e
      JOIN __signalEvents_${j} s ON (
        s.user_id = e.user_id
        AND s.interleave_id = e.interleave_id
        AND s.item_id = e.item_id
        AND s.first_event_timestamp >= e.exposure_timestamp
      )
      GROUP BY e.user_id, e.item_id
    )`,
    )
    .join("");

  // Ownership input: engagement per user x item across ALL events (a rollup
  // of __events when it is at impression grain)
  const eventsAllCTE = !includeOwnership
    ? ""
    : includePaired
      ? `,
    __eventsAll AS (
      SELECT
        ev.user_id,
        ev.item_id,
        ${ownershipIdx
          .map(
            (i) =>
              `${metrics[i].metricType === "proportion" ? "1" : `SUM(ev.value_${i})`} AS value_${i}`,
          )
          .join(",\n        ")}
      FROM __events ev
      GROUP BY ev.user_id, ev.item_id
    )`
      : ""; // without paired metrics __events is already at user x item grain
  const eventsAllName =
    includePaired && includeOwnership ? "__eventsAll" : "__events";

  // Paired input: NULL interleave_id events never satisfy this join
  const creditedCTE = !includePaired
    ? ""
    : `,
    __credited AS (
      SELECT
        e.user_id,
        e.interleave_id,
        e.item_id,
        e.team,
        ${pairedIdx
          .map((i) => `COALESCE(ev.value_${i}, 0) AS value_${i}`)
          .join(",\n        ")}
      FROM __exposures e
      LEFT JOIN __events ev ON (
        ev.user_id = e.user_id
        AND ev.interleave_id = e.interleave_id
        AND ev.item_id = e.item_id
        AND ev.first_event_timestamp >= e.exposure_timestamp
      )
    )`;

  // user x item grain: paired engaged-gated sums (per metric) and the
  // ownership share, all from one pass over the exposure rows
  const userItemCTE = includePaired
    ? `,
    __userItem AS (
      SELECT
        t.user_id,
        t.item_id,
        ${pairedIdx
          .map(
            (i) => `SUM(t.team * t.value_${i} * t.eng_${i}) AS x_${i},
        SUM((1 - t.team) * t.value_${i} * t.eng_${i}) AS y_${i},
        SUM(t.team * t.eng_${i}) AS n_${i},`,
          )
          .join("\n        ")}
        AVG(t.team * 1.0) AS share_t
      FROM (
        SELECT
          c.*,
          ${pairedIdx
            .map(
              (i) =>
                `${dialect.ifElse(
                  `SUM(c.value_${i}) OVER (PARTITION BY c.user_id, c.interleave_id) > 0`,
                  "1",
                  "0",
                )} AS eng_${i}`,
            )
            .join(",\n          ")}
        FROM __credited c
      ) t
      GROUP BY t.user_id, t.item_id
    )`
    : `,
    __userItem AS (
      SELECT
        e.user_id,
        e.item_id,
        AVG(e.team * 1.0) AS share_t
      FROM __exposures e
      GROUP BY e.user_id, e.item_id
    )`;

  const userCTE = `,
    __user AS (
      SELECT
        ui.user_id,
        ${pairedIdx
          .map(
            (i) => `SUM(ui.x_${i}) AS x_${i},
        SUM(ui.y_${i}) AS y_${i},
        SUM(ui.n_${i}) AS n_${i},`,
          )
          .join("\n        ")}
        ${ownershipIdx
          .map((i) => {
            // A user x item with no signaled exposure has no owner: both 0
            const share =
              kinds[i] === "signal"
                ? `COALESCE(ss_${signalJ[i]}.share_t, 0)`
                : "ui.share_t";
            const shareC =
              kinds[i] === "signal"
                ? `COALESCE(1 - ss_${signalJ[i]}.share_t, 0)`
                : "(1 - ui.share_t)";
            return `SUM(COALESCE(ea.value_${i}, 0) * ${share}) AS wins_t_${i},
        SUM(COALESCE(ea.value_${i}, 0) * ${shareC}) AS wins_c_${i},`;
          })
          .join("\n        ")}
        MAX(1) AS one
      FROM __userItem ui
      ${
        includeOwnership
          ? `LEFT JOIN ${eventsAllName} ea ON (
        ea.user_id = ui.user_id AND ea.item_id = ui.item_id
      )`
          : ""
      }
      ${usedSignals
        .map(
          (j) => `LEFT JOIN __signalShare_${j} ss_${j} ON (
        ss_${j}.user_id = ui.user_id AND ss_${j}.item_id = ui.item_id
      )`,
        )
        .join("\n      ")}
      GROUP BY ui.user_id
    )`;

  const gate = (i: number, expr: string) =>
    `SUM(${dialect.ifElse(`u.n_${i} > 0`, expr, "0")})`;
  const finalCols = kinds
    .map((kind, i) => {
      switch (kind) {
        case "paired":
          return `${gate(i, "1")} AS m${i}_users,
      ${gate(i, `u.x_${i}`)} AS m${i}_sum_x,
      ${gate(i, `u.x_${i} * u.x_${i}`)} AS m${i}_sum_xx,
      ${gate(i, `u.y_${i}`)} AS m${i}_sum_y,
      ${gate(i, `u.y_${i} * u.y_${i}`)} AS m${i}_sum_yy,
      ${gate(i, `u.n_${i}`)} AS m${i}_sum_n,
      ${gate(i, `u.n_${i} * u.n_${i}`)} AS m${i}_sum_nn,
      ${gate(i, `u.x_${i} * u.y_${i}`)} AS m${i}_sum_xy,
      ${gate(i, `u.x_${i} * u.n_${i}`)} AS m${i}_sum_xn,
      ${gate(i, `u.y_${i} * u.n_${i}`)} AS m${i}_sum_yn`;
        case "ownership":
        case "signal":
          return `SUM(${dialect.ifElse(`u.wins_t_${i} > u.wins_c_${i}`, "1", "0")}) AS m${i}_users_pref_treatment,
      SUM(${dialect.ifElse(`u.wins_c_${i} > u.wins_t_${i}`, "1", "0")}) AS m${i}_users_pref_control`;
        default: {
          const unknownKind: never = kind;
          throw new Error(`Unknown analysis kind: ${unknownKind}`);
        }
      }
    })
    .join(",\n      ");

  return format(
    `-- Interleaving metrics (one query per fact table)
    WITH
    ${exposuresCTE},
    ${eventsCTE}${signalCTEs}${eventsAllCTE}${creditedCTE}${userItemCTE}${userCTE}
    SELECT
      COUNT(*) AS users_exposed,
      ${finalCols}
    FROM __user u`,
    dialect.formatDialect,
  );
}
