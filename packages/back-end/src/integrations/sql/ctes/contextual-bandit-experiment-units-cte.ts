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

/**
 * Last-line injection guard before targeting columns are interpolated into raw
 * SQL. Columns are validated at input time
 * (`assertExposureQueriesTargetingAttributeColumnsValid`), so any unsafe
 * identifier reaching here indicates a validation bypass or corrupted data:
 * fail loudly rather than silently dropping it (which would produce subtly
 * wrong results). Returns the columns unchanged when all are safe.
 */
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
  // Not a contextual bandit at all — nothing to append, run as a standard query.
  if (!bs?.contextualBandit) {
    return null;
  }
  const columns = bs.targetingAttributeColumns ?? [];
  // Contextual bandit with no targeting attribute columns configured.
  // Rather than failing the run, we intentionally fall back to a null config:
  // the query is generated without any `attr_cb_*` context columns, so the
  // downstream weight engine collapses every user into a single global context
  // and still updates the variation weights — just identically for all users.
  // The caller is responsible for surfacing a warning (see
  // `hasUsableContextualBanditTargeting`), since this is a degraded state for
  // what is supposed to be a contextual bandit.
  if (!columns.length) {
    return null;
  }
  // Columns are present: they must be SQL-safe before interpolation. This throws
  // (rather than degrading) so a misconfigured/bypassed column fails loudly.
  const aliases = assertSafeTargetingSqlIdentifiers(columns);
  const k = Math.max(1, settings.variations?.length ?? 1);
  const maxRankedContexts = Math.max(
    1,
    Math.floor(dialect.maxContextualBanditContexts / k) - 1,
  );
  return { aliases, maxRankedContexts };
}

/**
 * True when a contextual bandit has at least one targeting attribute column
 * configured, i.e. it can actually segment users into distinct contexts. When
 * this is false the bandit still runs, but produces a single uniform set of
 * variation weights for every user. Column format is enforced separately at
 * query-build time (see `assertSafeTargetingSqlIdentifiers`).
 */
export function hasUsableContextualBanditTargeting(
  settings: ExperimentSnapshotSettings,
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
 * CTEs after __experimentUnitsBase: global counts by context tuple,
 * top-(maxRankedContexts) bucketing, and the final __experimentUnits.
 *
 * The bucketing step carries the base unit columns (`baseColumnRefs`) straight
 * through, so __experimentUnits is produced by a single LEFT JOIN from the
 * one-row-per-user base table to the ranked context counts. Because that join
 * never fans out (ranked counts are one row per distinct context tuple), there
 * is no need for a second join back to __experimentUnitsBase to re-attach the
 * base columns.
 */
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
