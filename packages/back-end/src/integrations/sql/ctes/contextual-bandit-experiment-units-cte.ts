import {
  NULL_ATTRIBUTE_VALUE,
  CONTEXTUAL_BANDIT_COMBINED_ATTRIBUTE_VALUE,
} from "shared/constants";
import {
  contextualBanditAttrCol,
  contextualBanditRawAttrCol,
} from "shared/experiments";
import type { SnapshotMetricRequest } from "shared/types/experiment-snapshot";
import type { DimensionColumnData } from "shared/types/integrations";
import type { SqlDialect } from "shared/types/sql";
import {
  formatMalformedTargetingAttributeColumnMessages,
  isSafeSqlIdentifier,
} from "shared/validators";

export function appendContextualBanditTargetingAttributeCols(
  dialect: SqlDialect,
  dimensionCols: DimensionColumnData[],
  settings: SnapshotMetricRequest,
): void {
  const cfg = getContextualBanditUnitsSqlConfig(dialect, settings);
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

/** Last-line SQL-injection guard: throws on unsafe column identifiers rather than dropping silently. */
export function assertSafeTargetingSqlIdentifiers(columns: string[]): string[] {
  const unsafe = columns.filter((c) => !isSafeSqlIdentifier(c));
  if (unsafe.length > 0) {
    throw new Error(formatMalformedTargetingAttributeColumnMessages(unsafe));
  }
  return columns;
}

export type ContextualBanditUnitsSqlConfig = {
  aliases: string[];
  maxRankedContexts: number;
};

export function getContextualBanditUnitsSqlConfig(
  dialect: SqlDialect,
  settings: SnapshotMetricRequest,
): ContextualBanditUnitsSqlConfig | null {
  const bs = settings.banditSettings;
  if (!bs?.contextualBandit) {
    return null;
  }
  const columns = bs.targetingAttributeColumns ?? [];
  // No targeting columns: fall back to a single global context (degraded but
  // still produces weight updates). Warning is surfaced by `hasUsableContextualBanditTargeting`.
  if (!columns.length) {
    return null;
  }
  const aliases = assertSafeTargetingSqlIdentifiers(columns);
  const k = Math.max(1, settings.variations?.length ?? 1);
  const maxRankedContexts = Math.max(
    1,
    Math.floor(dialect.maxContextualBanditContexts / k) - 1,
  );
  return { aliases, maxRankedContexts };
}

/** True when the CB has at least one targeting column and can segment users into distinct contexts. */
export function hasUsableContextualBanditTargeting(
  settings: SnapshotMetricRequest,
): boolean {
  const bs = settings.banditSettings;
  if (!bs?.contextualBandit) {
    return true;
  }
  return (bs.targetingAttributeColumns ?? []).length > 0;
}

/** Pass-through columns from __rawExperiment for contextual bandit targeting attributes. */
export function getContextualBanditExposureSelectCols(
  aliases: string[],
): string {
  return aliases.map((a) => `, e.${a}`).join("");
}

/** First-exposure targeting attribute on __experimentUnitsBase (same pattern as experiment dimensions). */
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

/** CTEs after __experimentUnitsBase: context-tuple counts, top-N bucketing, final __experimentUnits. */
export function getContextualBanditUnitsCTEs(
  dialect: SqlDialect,
  {
    aliases,
    maxRankedContexts,
    unitsBaseCteName,
    baseColumnRefs,
  }: {
    aliases: string[];
    maxRankedContexts: number;
    unitsBaseCteName: string;
    /** Base unit columns to pass through, each already prefixed with `u.`. */
    baseColumnRefs: string;
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
      dialect.castToString(`'${CONTEXTUAL_BANDIT_COMBINED_ATTRIBUTE_VALUE}'`),
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
    , __experimentUnits AS (
      SELECT
        ${baseColumnRefs}
        ${caseCols}
      FROM
        ${unitsBaseCteName} u
      LEFT JOIN __contextCountsRanked cc ON (
        ${joinOnMapped}
      )
    )`;
}
