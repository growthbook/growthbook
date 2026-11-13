import type { SqlDialect } from "shared/types/sql";

/**
 * One column per component rather than one pass flag: "matched every
 * component" can't be merged across unit-days, so the pass test runs last.
 * `prefix` is the slot alias (`m0`) in queries, or the encoded id in caches.
 */
export function compoundComponentColumn(prefix: string, index: number): string {
  return `${prefix}_c${index}`;
}

/** The same count over the pre-exposure covariate window. */
export function compoundCovariateComponentColumn(
  prefix: string,
  index: number,
): string {
  return `${prefix}_covariate_c${index}`;
}

/** Per variation: units that matched component k at least once. */
export function compoundComponentUnitsColumn(
  prefix: string,
  index: number,
): string {
  return `${prefix}_c${index}_units`;
}

const COMPOUND_COMPONENT_UNITS_COLUMN_RE = /^(m\d+)_c(\d+)_units$/;

export function isCompoundComponentUnitsColumn(column: string): boolean {
  return COMPOUND_COMPONENT_UNITS_COLUMN_RE.test(column);
}

/**
 * Units per compound component, by metric id then variation index, summed
 * over every row. Only valid for the overall result: gbstats renames and
 * merges dimensions, so per-dimension counts would have to replicate that.
 */
export function sumCompoundComponentUnits(
  queryResults: { rows: Record<string, unknown>[] }[],
  variationIds: string[],
): Map<string, number[][]> {
  const totals = new Map<string, number[][]>();
  for (const { rows } of queryResults) {
    for (const row of rows) {
      const v = variationIds.indexOf(String(row.variation));
      if (v < 0) continue;
      for (const [key, value] of Object.entries(row)) {
        const match = key.match(COMPOUND_COMPONENT_UNITS_COLUMN_RE);
        const metricId = match && row[`${match[1]}_id`];
        if (!match || typeof metricId !== "string") continue;
        const byVariation =
          totals.get(metricId) ?? variationIds.map((): number[] => []);
        const k = Number(match[2]);
        byVariation[v][k] = (byVariation[v][k] ?? 0) + (Number(value) || 0);
        totals.set(metricId, byVariation);
      }
    }
  }
  return totals;
}

/** Per-unit 0/1: every component matched at least once. */
export function compoundPassExpression(
  dialect: SqlDialect,
  componentRefs: string[],
): string {
  return dialect.castToFloat(
    `CASE WHEN ${componentRefs.map((ref) => `${ref} >= 1`).join(" AND ")} THEN 1 ELSE 0 END`,
  );
}
