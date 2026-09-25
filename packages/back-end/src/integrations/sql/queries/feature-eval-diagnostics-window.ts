import { subDays, subHours, subMinutes } from "date-fns";
import type {
  FeatureEvalDiagnosticsFilter,
  FeatureEvalDiagnosticsFilterColumn,
  FeatureEvalDiagnosticsQueryParams,
  FeatureEvalDiagnosticsRange,
  FeatureEvalDiagnosticsWindow,
} from "shared/types/integrations";
import type { SqlDialect } from "shared/types/sql";

/** Historical behaviour, kept exactly when a caller passes neither field. */
const DEFAULT_LOOKBACK_DAYS = 7;
const DEFAULT_LIMIT = 100;

/**
 * One definition of what a diagnostics lookback means, shared by the managed
 * warehouse and generic SQL builders. Without it the two would drift, and the
 * table would describe a different period depending on the data source.
 */
export function resolveFeatureEvalDiagnosticsWindow(
  params: FeatureEvalDiagnosticsQueryParams,
  now: Date = new Date(),
): FeatureEvalDiagnosticsWindow {
  const limit = params.limit ?? DEFAULT_LIMIT;

  switch (params.lookback) {
    case "15minute":
      return { start: subMinutes(now, 15), limit };
    case "hour":
      return { start: subHours(now, 1), limit };
    case "day":
      return { start: subDays(now, 1), limit };
    case "week":
      return { start: subDays(now, 7), limit };
    case undefined:
    default:
      // No lookback asked for: the historical 7-day window, unchanged.
      return { start: subDays(now, DEFAULT_LOOKBACK_DAYS), limit };
  }
}

/**
 * The only identifiers a filter can reach SQL as. The request names a KEY of
 * this table and the SQL gets the table's VALUE, so nothing from the request is
 * ever written into the query as an identifier.
 */
const FILTER_COLUMN_SQL: Record<FeatureEvalDiagnosticsFilterColumn, string> = {
  value: "value",
  source: "source",
  environment: "environment",
  ruleId: "ruleId",
  rule_id: "rule_id",
};

export function isFeatureEvalDiagnosticsFilterColumn(
  column: unknown,
): column is FeatureEvalDiagnosticsFilterColumn {
  return (
    typeof column === "string" &&
    Object.prototype.hasOwnProperty.call(FILTER_COLUMN_SQL, column)
  );
}

/** Longer than any flag value the stream is meant to be narrowed by. */
const MAX_FILTER_VALUE_LENGTH = 2048;
/** Longer than the widest bucket (the 7-day window's 2 hours) by a margin. */
const MAX_RANGE_MS = 8 * 24 * 60 * 60 * 1000;

/**
 * Validates the stream's narrowing from an untrusted request body. Returns the
 * parsed values, or an error message for a 400. Absent fields are fine; present
 * but malformed ones are rejected rather than ignored, so a bad client cannot
 * silently get an unfiltered stream it believes is filtered.
 */
export function parseFeatureEvalDiagnosticsNarrowing(body: {
  filter?: unknown;
  range?: unknown;
}):
  | {
      filter?: FeatureEvalDiagnosticsFilter;
      range?: FeatureEvalDiagnosticsRange;
    }
  | { error: string } {
  const out: {
    filter?: FeatureEvalDiagnosticsFilter;
    range?: FeatureEvalDiagnosticsRange;
  } = {};

  if (body.filter !== undefined && body.filter !== null) {
    const f = body.filter as { column?: unknown; value?: unknown };
    if (
      typeof f !== "object" ||
      !isFeatureEvalDiagnosticsFilterColumn(f.column)
    ) {
      return { error: "Invalid filter column" };
    }
    if (
      typeof f.value !== "string" ||
      f.value.length > MAX_FILTER_VALUE_LENGTH
    ) {
      return { error: "Invalid filter value" };
    }
    out.filter = { column: f.column, value: f.value };
  }

  if (body.range !== undefined && body.range !== null) {
    const r = body.range as { start?: unknown; end?: unknown };
    const start = typeof r === "object" ? r.start : undefined;
    const end = typeof r === "object" ? r.end : undefined;
    if (
      typeof start !== "number" ||
      typeof end !== "number" ||
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      end <= start ||
      end - start > MAX_RANGE_MS
    ) {
      return { error: "Invalid range" };
    }
    out.range = { start: new Date(start), end: new Date(end) };
  }

  return out;
}

/**
 * The narrowing as `AND …` clauses, shared by both builders. Empty when there is
 * nothing to narrow, so an unfiltered query is byte-for-byte what it was.
 *
 * `columnMap` lets a builder whose table names a field differently resolve the
 * alias — the managed warehouse has `ruleId` and no `rule_id`.
 */
export function getFeatureEvalDiagnosticsNarrowingSql(
  params: Pick<FeatureEvalDiagnosticsQueryParams, "filter" | "range">,
  dialect: Pick<SqlDialect, "escapeStringLiteral" | "toTimestamp">,
  columnMap: Partial<
    Record<
      FeatureEvalDiagnosticsFilterColumn,
      FeatureEvalDiagnosticsFilterColumn
    >
  > = {},
): string {
  const clauses: string[] = [];
  if (params.filter) {
    const requested = params.filter.column;
    // Re-checked here, not only in the controller: this is where it becomes
    // SQL, and a future caller may not go through that controller.
    if (!isFeatureEvalDiagnosticsFilterColumn(requested)) {
      throw new Error("Invalid filter column");
    }
    const column = FILTER_COLUMN_SQL[columnMap[requested] ?? requested];
    clauses.push(
      `${column} = '${dialect.escapeStringLiteral(params.filter.value)}'`,
    );
  }
  if (params.range) {
    clauses.push(
      `timestamp >= ${dialect.toTimestamp(params.range.start)}`,
      `timestamp < ${dialect.toTimestamp(params.range.end)}`,
    );
  }
  return clauses.map((c) => `\n        AND ${c}`).join("");
}
