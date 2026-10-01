import type {
  FeatureUsageRowFilter,
  FeatureUsageRowFilterColumn,
  FeatureUsageRowFilterOperator,
} from "shared/types/integrations";
import type { SqlDialect } from "shared/types/sql";

/**
 * Add Filter conditions for feature usage — the security boundary.
 *
 * The request is untrusted. parseFeatureUsageRowFilters turns it into the
 * closed FeatureUsageRowFilter type or rejects it with an error; nothing is
 * silently dropped. getFeatureUsageRowFiltersSql accepts only that type and
 * re-checks every field before writing SQL, so a caller that skips the parser
 * still cannot reach SQL with anything outside the whitelist.
 *
 * The translation is written here rather than delegated to the shared
 * getRowFilterSQL: that function also handles `sql_expr` (raw SQL) and
 * `saved_filter`, and the safest way to keep those unreachable is a
 * translator that has no case for them at all.
 */

/** Column -> SQL identifier. Looked up, never interpolated from input. */
const COLUMN_SQL: Record<FeatureUsageRowFilterColumn, string> = {
  value: "value",
  ruleId: "ruleId",
  source: "source",
  variationId: "variationId",
};

/** The only aliases, each valid only for its own column. */
const ALIAS_SQL: Record<
  NonNullable<FeatureUsageRowFilter["columnAlias"]>,
  { column: FeatureUsageRowFilterColumn; sql: string }
> = {
  rule_id: { column: "ruleId", sql: "rule_id" },
  variation_id: { column: "variationId", sql: "variation_id" },
};

/** How many values each operator takes. */
const OPERATOR_ARITY: Record<
  FeatureUsageRowFilterOperator,
  "one" | "many" | "none"
> = {
  "=": "one",
  "!=": "one",
  in: "many",
  not_in: "many",
  starts_with: "one",
  ends_with: "one",
  contains: "one",
  not_contains: "one",
  is_null: "none",
  not_null: "none",
};

/** Refused by name: getRowFilterSQL would pass raw SQL / stored filters through. */
const FORBIDDEN_OPERATORS = new Set(["sql_expr", "saved_filter"]);

const MAX_FILTERS = 20;
const MAX_VALUES = 100;
const MAX_VALUE_LENGTH = 2048;

const has = (o: object, k: unknown) =>
  typeof k === "string" && Object.prototype.hasOwnProperty.call(o, k);

function checkFilter(
  raw: unknown,
  allowAlias: boolean,
): FeatureUsageRowFilter | string {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return "Each filter must be an object";
  }
  const f = raw as Record<string, unknown>;
  if (typeof f.operator === "string" && FORBIDDEN_OPERATORS.has(f.operator)) {
    return `Filter operator not allowed: ${f.operator}`;
  }
  if (!has(COLUMN_SQL, f.column)) return "Invalid filter column";
  if (!has(OPERATOR_ARITY, f.operator)) return "Invalid filter operator";
  const column = f.column as FeatureUsageRowFilterColumn;
  const operator = f.operator as FeatureUsageRowFilterOperator;

  const values = f.values === undefined ? [] : f.values;
  if (
    !Array.isArray(values) ||
    values.length > MAX_VALUES ||
    !values.every((v) => typeof v === "string" && v.length <= MAX_VALUE_LENGTH)
  ) {
    return "Invalid filter values";
  }
  const arity = OPERATOR_ARITY[operator];
  if (
    (arity === "one" && values.length !== 1) ||
    (arity === "many" && values.length < 1) ||
    (arity === "none" && values.length !== 0)
  ) {
    return `Wrong number of values for ${operator}`;
  }

  let columnAlias: FeatureUsageRowFilter["columnAlias"];
  if (f.columnAlias !== undefined) {
    if (
      !allowAlias ||
      !has(ALIAS_SQL, f.columnAlias) ||
      ALIAS_SQL[f.columnAlias as keyof typeof ALIAS_SQL].column !== column
    ) {
      return "Invalid filter column alias";
    }
    columnAlias = f.columnAlias as FeatureUsageRowFilter["columnAlias"];
  }

  return {
    column,
    operator,
    values: values as string[],
    ...(columnAlias ? { columnAlias } : {}),
  };
}

/**
 * Parses untrusted filters. `allowAlias` only for the stream query on a
 * generic data source; the managed usage query has fixed column names.
 */
export function parseFeatureUsageRowFilters(
  raw: unknown,
  { allowAlias }: { allowAlias: boolean },
): { filters: FeatureUsageRowFilter[] } | { error: string } {
  if (raw === undefined || raw === null) return { filters: [] };
  if (!Array.isArray(raw) || raw.length > MAX_FILTERS) {
    return { error: "Invalid filters" };
  }
  const filters: FeatureUsageRowFilter[] = [];
  for (const item of raw) {
    const checked = checkFilter(item, allowAlias);
    if (typeof checked === "string") return { error: checked };
    filters.push(checked);
  }
  return { filters };
}

/**
 * The filters as `AND (...)` clauses; empty when there are none.
 *
 * Values are compared as stored text, never coerced. "No rule" is stored as an
 * empty string, not NULL, so for the rule column is_null / not_null mean
 * empty / non-empty (NULL included, for customer queries that emit it).
 */
export function getFeatureUsageRowFiltersSql(
  filters: FeatureUsageRowFilter[] | undefined,
  dialect: Pick<SqlDialect, "escapeStringLiteral" | "stringMatch">,
  { useAliases }: { useAliases: boolean },
): string {
  if (!filters?.length) return "";
  const clauses = filters.map((raw) => {
    // Re-checked here, where it becomes SQL: a caller that bypassed the
    // parser still cannot get anything outside the whitelist into a query.
    const checked = checkFilter(raw, useAliases);
    if (typeof checked === "string") throw new Error(checked);
    const f = checked;
    const col =
      useAliases && f.columnAlias
        ? ALIAS_SQL[f.columnAlias].sql
        : COLUMN_SQL[f.column];
    const lit = (v: string) => `'${dialect.escapeStringLiteral(v)}'`;
    switch (f.operator) {
      case "=":
        return `${col} = ${lit(f.values[0])}`;
      case "!=":
        return `${col} != ${lit(f.values[0])}`;
      case "in":
        return `${col} IN (${f.values.map(lit).join(", ")})`;
      case "not_in":
        return `${col} NOT IN (${f.values.map(lit).join(", ")})`;
      case "starts_with":
      case "ends_with":
      case "contains":
      case "not_contains":
        return dialect.stringMatch(col, f.operator, f.values[0]);
      case "is_null":
        return f.column === "ruleId"
          ? `(${col} IS NULL OR ${col} = '')`
          : `${col} IS NULL`;
      case "not_null":
        return f.column === "ruleId"
          ? `(${col} IS NOT NULL AND ${col} != '')`
          : `${col} IS NOT NULL`;
    }
  });
  return clauses.map((c) => `\n        AND (${c})`).join("");
}
