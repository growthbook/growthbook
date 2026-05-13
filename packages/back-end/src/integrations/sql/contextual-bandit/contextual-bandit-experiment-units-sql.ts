import type { ExperimentSnapshotSettings } from "shared/types/experiment-snapshot";
import type { DimensionColumnData } from "shared/types/integrations";
import type { SqlDialect } from "shared/types/sql";

const SAFE_SQL_IDENT = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export function appendContextualBanditTargetingDimensionCols(
  dimensionCols: DimensionColumnData[],
  settings: ExperimentSnapshotSettings,
): void {
  const cfg = getContextualBanditUnitsSqlConfig(settings);
  if (!cfg) {
    return;
  }
  for (const a of cfg.aliases) {
    dimensionCols.push({
      alias: `gb_ctx_${a}`,
      value: `gb_ctx_${a}`,
    });
  }
}

export function getSafeTargetingSqlIdentifiers(columns: string[]): string[] {
  return columns.filter((c) => SAFE_SQL_IDENT.test(c));
}

export type ContextualBanditUnitsSqlConfig = {
  aliases: string[];
  maxRankedContexts: number;
};

export function getContextualBanditUnitsSqlConfig(
  settings: ExperimentSnapshotSettings,
): ContextualBanditUnitsSqlConfig | null {
  const bs = settings.banditSettings;
  if (!bs?.banditIsContextual || !bs.targetingAttributeColumns?.length) {
    return null;
  }
  const aliases = getSafeTargetingSqlIdentifiers(bs.targetingAttributeColumns);
  if (!aliases.length) {
    return null;
  }
  const k = Math.max(1, settings.variations?.length ?? 1);
  const maxRankedContexts = Math.max(1, Math.floor(3000 / k));
  return { aliases, maxRankedContexts };
}

/**
 * Extra SELECT columns on __experimentExposures (from alias `e`) for contextual bandits.
 */
export function getContextualBanditExposureSelectCols(
  dialect: SqlDialect,
  aliases: string[],
): string {
  return aliases
    .map((a) => `, ${dialect.castToString(`e.${a}`)} AS gb_raw_ctx_${a}`)
    .join("");
}

/**
 * CTEs after __experimentExposures: first-exposure context per user, global counts
 * by context tuple, top-(3000/K) bucketing, and one mapped context row per user.
 */
export function getContextualBanditIntermediateCtes(
  dialect: SqlDialect,
  {
    baseIdType,
    timestampColumn,
    aliases,
    maxRankedContexts,
  }: {
    baseIdType: string;
    timestampColumn: string;
    aliases: string[];
    maxRankedContexts: number;
  },
): string {
  const ctxGroupBy = aliases.map((a) => `gb_ctx_${a}`).join(", ");
  const joinOnMapped = aliases
    .map((a) => `u.gb_ctx_${a} = cc.gb_ctx_${a}`)
    .join(" AND ");
  const keepContextExpr = `COALESCE(cc.__gb_ctx_rn2, 999999999) <= ${maxRankedContexts}`;
  const caseCols = aliases
    .map(
      (a) => `
    , ${dialect.ifElse(
      keepContextExpr,
      `u.gb_ctx_${a}`,
      dialect.castToString("'Combined'"),
    )} AS gb_ctx_${a}`,
    )
    .join("");

  return `
    , __gb_expWithCtxRn AS (
      SELECT
        e.*
        , ROW_NUMBER() OVER (PARTITION BY e.${baseIdType} ORDER BY ${timestampColumn}) AS __gb_ctx_rn
      FROM
        __experimentExposures e
    )
    , __gb_userFirstCtx AS (
      SELECT
        e.${baseIdType}
        ${aliases.map((a) => `, e.gb_raw_ctx_${a} AS gb_ctx_${a}`).join("")}
      FROM
        __gb_expWithCtxRn e
      WHERE
        e.__gb_ctx_rn = 1
    )
    , __contextCounts AS (
      SELECT
        ${ctxGroupBy}
        , COUNT(*) AS __gb_user_cnt
      FROM
        __gb_userFirstCtx
      GROUP BY
        ${ctxGroupBy}
    )
    , __contextCountsRanked AS (
      SELECT
        ${ctxGroupBy}
        , __gb_user_cnt
        , ROW_NUMBER() OVER (ORDER BY __gb_user_cnt DESC) AS __gb_ctx_rn2
      FROM
        __contextCounts
    )
    , __gb_userContextMapped AS (
      SELECT
        u.${baseIdType}
        ${caseCols}
      FROM
        __gb_userFirstCtx u
      LEFT JOIN __contextCountsRanked cc ON (
        ${joinOnMapped}
      )
    )`;
}

export function getContextualBanditExperimentUnitsJoinAndSelect(
  baseIdType: string,
  aliases: string[],
): { joinSql: string; selectCols: string; groupByCols: string } {
  const joinSql = `
      INNER JOIN __gb_userContextMapped __gb_ctx ON (
        __gb_ctx.${baseIdType} = e.${baseIdType}
      )`;
  const selectCols = aliases
    .map((a) => `, __gb_ctx.gb_ctx_${a} AS gb_ctx_${a}`)
    .join("");
  const groupByCols = `, ${aliases.map((a) => `__gb_ctx.gb_ctx_${a}`).join(", ")}`;
  return { joinSql, selectCols, groupByCols };
}
