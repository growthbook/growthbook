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
 * for narrowing rows already in memory. The two must agree: a filter applied
 * here and the same filter pushed to the warehouse have to select the same
 * rows, or escalating to a full-window query would silently change the result.
 */
export function matchesRowFilter<T>(
  row: T,
  filter: RowFilter,
  getValue: RowValueAccessor<T>,
): boolean {
  if (filter.operator === "sql_expr" || filter.operator === "saved_filter") {
    return true;
  }

  if (!filter.column) return true;

  const raw = getValue(row, filter.column);
  const value = raw === undefined ? null : raw;

  if (filter.operator === "is_null") return value === null;
  if (filter.operator === "not_null") return value !== null;

  if (value === null) return false;

  const values = filter.values ?? [];
  const first = values[0] ?? "";

  switch (filter.operator) {
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
      return globToRegExp(first).test(value);
    case "not_matches_pattern":
      return !globToRegExp(first).test(value);
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
    // someone decides what it means client-side. The two implementations have
    // to agree or escalating a filter to the warehouse changes the result.
  }
  return false;
}

export function applyRowFilters<T>(
  rows: T[],
  filters: RowFilter[],
  getValue: RowValueAccessor<T>,
): T[] {
  const active = filters.filter(isRowFilterComplete);
  if (!active.length) return rows;
  return rows.filter((row) =>
    active.every((filter) => matchesRowFilter(row, filter, getValue)),
  );
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
    .join("");
  return new RegExp(`^${source}$`, "s");
}
