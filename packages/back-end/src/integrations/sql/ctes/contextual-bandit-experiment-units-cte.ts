import { NULL_ATTRIBUTE_VALUE } from "shared/constants";
import {
  contextualBanditAttrCol,
  contextualBanditRawAttrCol,
} from "shared/experiments";
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
    const col = contextualBanditAttrCol(a);
    dimensionCols.push({
      alias: col,
      value: col,
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

/** Pass-through columns from __rawExperiment for contextual bandit targeting attributes. */
export function getContextualBanditExposureSelectCols(
  aliases: string[],
): string {
  return aliases.map((a) => `, e.${a}`).join("");
}

/**
 * First-exposure targeting attribute on __experimentUnitsBase (same pattern as experiment dimensions).
 */
export function getAttributeValuePerUnit(
  dialect: SqlDialect,
  alias: string,
  timestampColumn: string,
): string {
  return `SUBSTRING(
        MIN(
          CONCAT(SUBSTRING(${dialect.formatDateTimeString(timestampColumn)}, 1, 19),
            coalesce(${dialect.castToString(
              `e.${alias}`,
            )}, ${dialect.castToString(`'${NULL_ATTRIBUTE_VALUE}'`)})
          )
        ),
        20,
        99999
      )`;
}

export function getContextualBanditUnitsBaseSelectCols(
  dialect: SqlDialect,
  aliases: string[],
  timestampColumn: string,
): string {
  return aliases
    .map(
      (a) =>
        `, ${getAttributeValuePerUnit(
          dialect,
          a,
          timestampColumn,
        )} AS ${contextualBanditRawAttrCol(a)}`,
    )
    .join("");
}

/**
 * CTEs after __experimentUnitsBase: global counts by context tuple, top-(3000/K)
 * bucketing, and one mapped context row per user.
 */
export function getContextualBanditIntermediateCTEs(
  dialect: SqlDialect,
  {
    baseIdType,
    aliases,
    maxRankedContexts,
    unitsBaseCteName,
  }: {
    baseIdType: string;
    aliases: string[];
    maxRankedContexts: number;
    unitsBaseCteName: string;
  },
): string {
  const ctxGroupBy = aliases
    .map((a) => contextualBanditRawAttrCol(a))
    .join(", ");
  const joinOnMapped = aliases
    .map(
      (a) =>
        `u.${contextualBanditRawAttrCol(a)} = cc.${contextualBanditRawAttrCol(a)}`,
    )
    .join(" AND ");
  const keepContextExpr = `COALESCE(cc.__attr_cb_ctx_rn, 999999999) <= ${maxRankedContexts}`;
  const caseCols = aliases
    .map(
      (a) => `
    , ${dialect.ifElse(
      keepContextExpr,
      `u.${contextualBanditRawAttrCol(a)}`,
      dialect.castToString("'Combined'"),
    )} AS ${contextualBanditAttrCol(a)}`,
    )
    .join("");

  return `
    , __contextCounts AS (
      SELECT
        ${ctxGroupBy}
        , COUNT(*) AS __attr_cb_user_cnt
      FROM
        ${unitsBaseCteName}
      GROUP BY
        ${ctxGroupBy}
    )
    , __contextCountsRanked AS (
      SELECT
        ${ctxGroupBy}
        , __attr_cb_user_cnt
        , ROW_NUMBER() OVER (ORDER BY __attr_cb_user_cnt DESC) AS __attr_cb_ctx_rn
      FROM
        __contextCounts
    )
    , __attr_cb_userContextMapped AS (
      SELECT
        u.${baseIdType}
        ${caseCols}
      FROM
        ${unitsBaseCteName} u
      LEFT JOIN __contextCountsRanked cc ON (
        ${joinOnMapped}
      )
    )`;
}

/**
 * Final __experimentUnits with bucketed attr_cb_* columns joined from mapped contexts.
 */
export function getContextualBanditFinalUnitsCTE(
  baseIdType: string,
  aliases: string[],
  baseColumnRefs: string,
): string {
  return `
    , __experimentUnits AS (
      SELECT
        ${baseColumnRefs}
        ${aliases
          .map(
            (a) =>
              `, m.${contextualBanditAttrCol(a)} AS ${contextualBanditAttrCol(a)}`,
          )
          .join("")}
      FROM
        __experimentUnitsBase b
      INNER JOIN __attr_cb_userContextMapped m ON (
        m.${baseIdType} = b.${baseIdType}
      )
    )`;
}
