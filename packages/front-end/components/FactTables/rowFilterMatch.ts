import { RowFilter } from "shared/types/fact-table";
import { isRowFilterComplete } from "./rowFilterUtils";

/**
 * Reads the value a filter's column names out of a row. Rows differ per
 * surface (an exposure record nests its dimensions, a flat result set does
 * not), so the caller owns the lookup.
 */
export type RowValueAccessor<T> = (
  row: T,
  column: string,
) => string | null | undefined;

/**
 * Client-side twin of `getRowFilterSQL` (shared/src/experiments/experiments.ts),
 * for narrowing rows already in memory.
 */
export function matchesRowFilter<T>(
  row: T,
  filter: RowFilter,
  getValue: RowValueAccessor<T>,
): boolean {
  return compileRowFilter(filter, getValue)(row);
}

export function compileRowFilter<T>(
  filter: RowFilter,
  getValue: RowValueAccessor<T>,
): (row: T) => boolean {
  if (filter.operator === "sql_expr" || filter.operator === "saved_filter") {
    return () => true;
  }

  // Still being typed. Treated as a no-op by applyRowFilters, never "match none".
  const column = filter.column;
  if (!column) return () => true;

  const operator = filter.operator;
  const values = (filter.values ?? []).map(fold);
  const first = values[0] ?? "";
  const pattern =
    operator === "matches_pattern" || operator === "not_matches_pattern"
      ? globToRegExp(first)
      : null;

  return (row: T) => {
    const raw = getValue(row, column);
    const value = raw === undefined || raw === null ? null : fold(raw);

    if (operator === "is_null") return value === null;
    if (operator === "not_null") return value !== null;

    // Everything below compares against a value, which NULL has none of.
    if (value === null) return false;

    switch (operator) {
      case "=":
        return value === first;
      case "!=":
        return value !== first;
      case "in":
        return values.includes(value);
      case "not_in":
        return !values.includes(value);
      case "starts_with":
        return value.startsWith(first);
      case "ends_with":
        return value.endsWith(first);
      case "contains":
        return value.includes(first);
      case "not_contains":
        return !value.includes(first);
      case "matches_pattern":
        return !!pattern?.test(value);
      case "not_matches_pattern":
        return !pattern?.test(value);

      // Numeric, date and boolean operators. Reachable only if a caller offers
      // columns typed as something other than string, which no surface does
      // yet. Match nothing rather than silently widening the result.
      case "<":
      case "<=":
      case ">":
      case ">=":
      case "between":
      case "not_between":
      case "is_true":
      case "is_false":
        return false;

      // IMPORTANT: no default, so a new operator fails the build here until
      // someone decides what it means client-side.
    }
    return false;
  };
}

export function applyRowFilters<T>(
  rows: T[],
  filters: RowFilter[],
  getValue: RowValueAccessor<T>,
): T[] {
  const matchers = filters
    .filter(isRowFilterComplete)
    .map((filter) => compileRowFilter(filter, getValue));
  if (!matchers.length) return rows;
  return rows.filter((row) => matchers.every((matches) => matches(row)));
}

function fold(value: string): string {
  return value.toLowerCase();
}

/**
 * The user-facing wildcard pattern, as a RegExp. Mirrors `globToLikePattern`
 * in shared/sql.ts: `*` matches any run, `?` exactly one, everything else is
 * literal. Anchored, because LIKE matches the whole value.
 */
function globToRegExp(glob: string): RegExp {
  const source = glob
    .split(/([*?])/)
    .map((chunk) => {
      if (chunk === "*") return ".*";
      if (chunk === "?") return ".";
      return chunk.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("")
    // A run of `*` means the same as one, but each extra `.*` multiplies the
    // backtracking the engine does against a long non-matching value.
    .replace(/(?:\.\*)+/g, ".*");
  return new RegExp(`^${source}$`, "s");
}
