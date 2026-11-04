import { isEqual } from "lodash";
import { RowFilter } from "shared/types/fact-table";
import { stringRowFilterOperators } from "shared/validators";
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
      ? parseGlob(first)
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
        return !!pattern && matchesGlob(value, pattern);
      case "not_matches_pattern":
        return !pattern || !matchesGlob(value, pattern);

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

interface Glob {
  segments: string[];
  leadingStar: boolean;
  trailingStar: boolean;
}

function parseGlob(glob: string): Glob {
  return {
    segments: glob.split("*").filter((seg) => seg !== ""),
    leadingStar: glob.startsWith("*"),
    trailingStar: glob.endsWith("*"),
  };
}

function segmentMatchesAt(value: string, segment: string, at: number): boolean {
  if (at < 0 || at + segment.length > value.length) return false;
  for (let i = 0; i < segment.length; i++) {
    const c = segment[i];
    if (c !== "?" && c !== value[at + i]) return false;
  }
  return true;
}

function indexOfSegment(
  value: string,
  segment: string,
  from: number,
  to: number,
): number {
  for (let at = from; at + segment.length <= to; at++) {
    if (segmentMatchesAt(value, segment, at)) return at;
  }
  return -1;
}

/**
 * Anchored glob match, because LIKE matches the whole value.
 */
function matchesGlob(value: string, glob: Glob): boolean {
  const { segments, leadingStar, trailingStar } = glob;

  // "" matches only the empty string; "*", "**", ... match anything.
  if (!segments.length) return leadingStar || value.length === 0;

  // No wildcard at all: the segment is the entire value. Handled up front
  // because the loop below would otherwise anchor the same segment twice.
  if (!leadingStar && !trailingStar && segments.length === 1) {
    return (
      value.length === segments[0].length &&
      segmentMatchesAt(value, segments[0], 0)
    );
  }

  let from = 0;
  let to = value.length;
  let firstFloating = 0;
  let endFloating = segments.length;

  if (!leadingStar) {
    const segment = segments[0];
    if (!segmentMatchesAt(value, segment, 0)) return false;
    from = segment.length;
    firstFloating = 1;
  }
  if (!trailingStar) {
    const segment = segments[segments.length - 1];
    const at = to - segment.length;
    if (at < from || !segmentMatchesAt(value, segment, at)) return false;
    to = at;
    endFloating = segments.length - 1;
  }

  for (let i = firstFloating; i < endFloating; i++) {
    const segment = segments[i];
    const found = indexOfSegment(value, segment, from, to);
    if (found === -1) return false;
    from = found + segment.length;
  }
  return true;
}

export function rowFilterIsLocallyEvaluable(filter: RowFilter): boolean {
  return (
    !!filter.column &&
    (stringRowFilterOperators as readonly string[]).includes(filter.operator)
  );
}

export function canNarrowLoadedRows({
  loadedFilters,
  nextFilters,
  truncated,
}: {
  loadedFilters: RowFilter[] | null;
  nextFilters: RowFilter[];
  truncated: boolean;
}): boolean {
  if (loadedFilters === null) return false;
  if (truncated) return false;

  const remaining = [...nextFilters];
  for (const filter of loadedFilters) {
    const i = remaining.findIndex((next) => isEqual(next, filter));
    if (i === -1) return false;
    remaining.splice(i, 1);
  }

  return remaining.every(rowFilterIsLocallyEvaluable);
}
