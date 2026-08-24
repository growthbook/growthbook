import normal from "@stdlib/stats/base/dists/normal";
import cloneDeep from "lodash/cloneDeep";
import uniqid from "uniqid";
import {
  DEFAULT_GUARDRAIL_ALPHA,
  DEFAULT_PROPER_PRIOR_STDDEV,
  DEFAULT_REGRESSION_ADJUSTMENT_DAYS,
  DEFAULT_REGRESSION_ADJUSTMENT_ENABLED,
  PRECOMPUTED_DIMENSION_PREFIX,
  NULL_DIMENSION_VALUE,
  NULL_DIMENSION_DISPLAY,
} from "shared/constants";
import {
  MetricDefinitionInterface,
  MetricInterface,
} from "shared/types/metric";
import {
  ColumnInterface,
  ColumnRef,
  FactMetricInterface,
  FactTableColumnType,
  FactTableDefinition,
  FactTableDefinitionMap,
  FactTableInterface,
  FactTableMap,
  FunnelFactMetricInterface,
  MetricQuantileSettings,
  MetricWindowSettings,
  RowFilter,
  StandardFactMetricInterface,
} from "shared/types/fact-table";
import {
  MetricDefaults,
  OrganizationSettings,
} from "shared/types/organization";
import {
  AttributionModel,
  ExperimentInterface,
  ExperimentInterfaceStringDates,
  LookbackOverride,
  MetricOverride,
} from "shared/types/experiment";
import {
  ExperimentReportResultDimension,
  MetricSnapshotSettings,
} from "shared/types/report";
import {
  DataSourceInterfaceWithParams,
  DataSourceSettings,
} from "shared/types/datasource";
import { SnapshotMetric } from "shared/types/experiment-snapshot";
import {
  DifferenceType,
  IndexedPValue,
  PValueCorrection,
  StatsEngine,
} from "shared/types/stats";
import { MetricGroupInterface } from "shared/types/metric-groups";
import {
  SqlIdentifierQuote,
  StringMatchFn,
  TemplateVariables,
} from "shared/types/sql";
import { stringToBoolean } from "../util";
import { getCappingTailState } from "../validators/fact-table";

export type ExperimentMetricInterface = MetricInterface | FactMetricInterface;

// Metrics as returned by the definitions endpoint, where legacy metrics are
// slimmed (fact metrics are always returned in full). A full
// ExperimentMetricInterface is assignable to this type.
export type ExperimentMetricDefinition =
  | MetricDefinitionInterface
  | FactMetricInterface;

export type ExperimentSortBy =
  | "significance"
  | "change"
  | "metrics"
  | "metricTags"
  | null;
export type SetExperimentSortBy = (value: ExperimentSortBy) => void;

export function formatDimensionValueForDisplay(
  value: string | undefined,
): string {
  if (!value) return "";
  if (value === NULL_DIMENSION_VALUE) {
    return NULL_DIMENSION_DISPLAY;
  }

  return value;
}

export function isFactMetricId(id: string): boolean {
  return !!id.match(/^fact__/);
}

export function isMetricGroupId(id: string): boolean {
  return !!id.match(/^mg_/);
}

export function isFactMetric(
  m: ExperimentMetricDefinition,
): m is FactMetricInterface {
  if (!m || typeof m !== "object") return false;
  return "metricType" in m;
}

export function isLegacyMetric(
  m: ExperimentMetricInterface,
): m is MetricInterface;
export function isLegacyMetric(
  m: ExperimentMetricDefinition,
): m is MetricDefinitionInterface;
export function isLegacyMetric(m: ExperimentMetricDefinition): boolean {
  return !isFactMetric(m);
}

export function canInlineFilterColumn(
  factTable: Pick<FactTableInterface, "userIdTypes" | "columns">,
  column: string,
): boolean {
  // If the column is one of the identifier columns, it is not eligible for prompting
  if (factTable.userIdTypes.includes(column)) return false;

  const dataType = getSelectedColumnDatatype({
    factTable,
    column,
    excludeDeleted: true,
  });

  if (dataType !== "string" && dataType !== "boolean") {
    return false;
  }

  return true;
}

// Standard SQL quotes identifiers with double quotes; only MySQL, BigQuery,
// and Databricks (Spark) use backticks. When the active data source's dialect
// is unknown we assume the standard, which is correct for every dialect except
// those three.
export const DEFAULT_IDENTIFIER_QUOTE: SqlIdentifierQuote = '"';

function isBareIdentifierChar(c: string): boolean {
  return (
    (c >= "a" && c <= "z") ||
    (c >= "A" && c <= "Z") ||
    (c >= "0" && c <= "9") ||
    c === "_"
  );
}

// Walk a SQL string and rewrite bare or quoted references to any of `names`,
// correctly skipping spans where a matching token must NOT be treated as a
// column reference:
//   - single-quoted string literals ('' escapes a quote),
//   - `--` line comments and `/* */` block comments,
//   - dollar-quoted string bodies ($tag$...$tag$, Postgres),
//   - and, depending on the dialect, the "other" quote character: whichever of
//     " or ` is NOT the dialect's identifier quote delimits string literals.
//
// `identifierQuote` says which quote character delimits identifiers for the
// active data source. A span in that quote is a *quoted identifier* (so
// `"margin_vc"` / `` `margin_vc` `` can reference a column); a span in the
// opposite quote is a string literal and is left alone. This matters because
// e.g. `"margin_vc"` is a quoted identifier in Postgres but a string literal
// in MySQL.
//
// `replacer(name, quoted)` returns the replacement for a matched identifier;
// `quoted` tells it whether the match came from a quoted-identifier span so it
// can re-quote when qualifying. Identifiers preceded by `.` (ignoring
// whitespace, so `m.price` and `m . price` both count) are skipped so
// already-qualified names are not re-qualified. Single
// pass — inserted replacement text is never re-scanned, so an inserted
// `m.price` is never re-qualified into `m.m.price`.
function replaceSqlIdentifiers(
  sql: string,
  names: string[],
  replacer: (name: string, quoted: boolean) => string,
  identifierQuote: SqlIdentifierQuote = DEFAULT_IDENTIFIER_QUOTE,
): string {
  if (!names.length) return sql;
  const nameSet = new Set(names);
  // Whichever quote is not the identifier quote delimits string literals.
  const stringQuote = identifierQuote === '"' ? "`" : '"';

  let out = "";
  let i = 0;
  const n = sql.length;

  // Consume a quote-delimited span starting at `i` (which is the opening
  // quote), honoring doubled-quote escapes. Returns the end index (exclusive)
  // and the unescaped inner text, plus whether a closing quote was found.
  const readQuoted = (quote: string) => {
    let j = i + 1;
    let inner = "";
    let closed = false;
    while (j < n) {
      if (sql[j] === quote) {
        if (sql[j + 1] === quote) {
          inner += quote;
          j += 2;
          continue;
        }
        j++;
        closed = true;
        break;
      }
      inner += sql[j];
      j++;
    }
    return { end: j, inner, closed };
  };

  // Whether the identifier about to be emitted is already qualified by a
  // preceding `.`. SQL allows whitespace around the dot (`m . price`), so skip
  // any trailing whitespace before looking for the qualifier.
  const isAlreadyQualified = () => {
    let k = out.length - 1;
    while (k >= 0 && /\s/.test(out[k])) k--;
    return k >= 0 && out[k] === ".";
  };

  while (i < n) {
    const c = sql[i];

    // Single-quoted string literal.
    if (c === "'") {
      const { end } = readQuoted("'");
      out += sql.slice(i, end);
      i = end;
      continue;
    }

    // Line comment: -- ... to end of line.
    if (c === "-" && sql[i + 1] === "-") {
      let j = i + 2;
      while (j < n && sql[j] !== "\n") j++;
      out += sql.slice(i, j);
      i = j;
      continue;
    }

    // Block comment: /* ... */.
    if (c === "/" && sql[i + 1] === "*") {
      let j = i + 2;
      while (j < n && !(sql[j] === "*" && sql[j + 1] === "/")) j++;
      j = Math.min(n, j + 2);
      out += sql.slice(i, j);
      i = j;
      continue;
    }

    // Dollar-quoted string ($tag$...$tag$). Only treated as a string when a
    // valid closing delimiter exists; otherwise `$` is an ordinary character
    // (e.g. a positional parameter or `col$1`).
    if (c === "$") {
      const open = sql.slice(i).match(/^\$([A-Za-z_][A-Za-z0-9_]*)?\$/);
      if (open) {
        const delim = open[0];
        const close = sql.indexOf(delim, i + delim.length);
        if (close !== -1) {
          const end = close + delim.length;
          out += sql.slice(i, end);
          i = end;
          continue;
        }
      }
      out += c;
      i++;
      continue;
    }

    // Quoted identifier in the dialect's identifier quote.
    if (c === identifierQuote) {
      const { end, inner, closed } = readQuoted(identifierQuote);
      if (closed && !isAlreadyQualified() && nameSet.has(inner)) {
        out += replacer(inner, true);
      } else {
        out += sql.slice(i, end);
      }
      i = end;
      continue;
    }

    // A span in the opposite quote is a string literal for this dialect; skip.
    if (c === stringQuote) {
      const { end } = readQuoted(stringQuote);
      out += sql.slice(i, end);
      i = end;
      continue;
    }

    // Bare identifier run.
    if (isBareIdentifierChar(c)) {
      let j = i;
      while (j < n && isBareIdentifierChar(sql[j])) j++;
      const token = sql.slice(i, j);
      // A run starting with a digit is a numeric literal, not an identifier.
      const startsWithDigit = c >= "0" && c <= "9";
      if (!startsWithDigit && !isAlreadyQualified() && nameSet.has(token)) {
        out += replacer(token, false);
      } else {
        out += token;
      }
      i = j;
      continue;
    }

    out += c;
    i++;
  }

  return out;
}

// A virtual column's expression is inlined into generated SQL as `(<sql>)`, so
// the expression must not be able to break out of those parentheses. Validate
// that it is a single self-contained scalar expression: no statement
// separator, no unbalanced parenthesis, and no unterminated literal or comment
// that would swallow the closing paren (and whatever follows it) in the
// generated query. Lexical rules mirror `replaceSqlIdentifiers` so literals and
// comments are consistently ignored.
//
// This is a structural guard, not a capability guard: a balanced expression may
// still contain a subquery, which is the same read access the fact table's own
// SQL already has. Returns an error message, or null when the expression is
// structurally safe.
export function validateVirtualColumnExpression(
  sql: string,
  identifierQuote: SqlIdentifierQuote = DEFAULT_IDENTIFIER_QUOTE,
): string | null {
  const stringQuote = identifierQuote === '"' ? "`" : '"';
  const n = sql.length;
  let i = 0;
  let depth = 0;

  // Consume a quote-delimited span starting at the opening quote at `i`,
  // honoring doubled-quote escapes. Returns the end index (exclusive) and
  // whether a closing quote was found.
  const readQuoted = (quote: string) => {
    let j = i + 1;
    let closed = false;
    while (j < n) {
      if (sql[j] === quote) {
        if (sql[j + 1] === quote) {
          j += 2;
          continue;
        }
        j++;
        closed = true;
        break;
      }
      j++;
    }
    return { end: j, closed };
  };

  while (i < n) {
    const c = sql[i];

    if (c === "'" || c === stringQuote || c === identifierQuote) {
      const { end, closed } = readQuoted(c);
      if (!closed) {
        return "SQL expression has an unterminated quoted string or identifier";
      }
      i = end;
      continue;
    }

    // Line comment: must be terminated by a newline, otherwise it would
    // comment out the closing paren of the inlined expression.
    if (c === "-" && sql[i + 1] === "-") {
      const j = sql.indexOf("\n", i + 2);
      if (j === -1) {
        return "SQL expression ends in a line comment; remove it or add a newline after it";
      }
      i = j + 1;
      continue;
    }

    // Block comment: must be closed.
    if (c === "/" && sql[i + 1] === "*") {
      const j = sql.indexOf("*/", i + 2);
      if (j === -1) {
        return "SQL expression has an unterminated block comment";
      }
      i = j + 2;
      continue;
    }

    // Dollar-quoted string ($tag$...$tag$). Only a string when a valid closing
    // delimiter exists; otherwise `$` is an ordinary character.
    if (c === "$") {
      const open = sql.slice(i).match(/^\$([A-Za-z_][A-Za-z0-9_]*)?\$/);
      if (open) {
        const delim = open[0];
        const close = sql.indexOf(delim, i + delim.length);
        if (close !== -1) {
          i = close + delim.length;
          continue;
        }
      }
      i++;
      continue;
    }

    if (c === ";") {
      return "SQL expression cannot contain ';' — it must be a single expression, not a statement";
    }

    if (c === "(") depth++;
    if (c === ")") {
      depth--;
      // Going negative means the expression closes a paren it never opened, so
      // it would escape the wrapping parentheses in the generated query.
      if (depth < 0) {
        return "SQL expression has an unbalanced ')'";
      }
    }

    i++;
  }

  if (depth !== 0) {
    return "SQL expression has an unbalanced '('";
  }

  return null;
}

// Resolve a virtual column's expression into valid SQL for the current query
// context. Any fact table column name appearing in the expression is rewritten:
// a real column becomes `alias.<col>` (bare when no alias), and a nested virtual
// column is expanded recursively — so chains (margin -> margin_pct) produce
// fully-inlined SQL. String literals and comments are skipped; quoted
// identifiers (per `identifierQuote`) are matched and re-quoted when qualified.
// `seen` guards against cyclic definitions.
function resolveVirtualColumnSql(
  col: Pick<ColumnInterface, "column" | "sql">,
  factTable: Pick<FactTableInterface, "columns">,
  alias: string,
  identifierQuote: SqlIdentifierQuote = DEFAULT_IDENTIFIER_QUOTE,
  seen: Set<string> = new Set(),
): string {
  const sql = col.sql || "";
  if (seen.has(col.column)) return sql;
  const nextSeen = new Set(seen).add(col.column);

  const names = factTable.columns
    .map((c) => c.column)
    .filter((name) => name !== col.column);

  return replaceSqlIdentifiers(
    sql,
    names,
    (name, quoted) => {
      const target = factTable.columns.find((c) => c.column === name);
      if (target?.isVirtual && target.sql) {
        return `(${resolveVirtualColumnSql(
          target,
          factTable,
          alias,
          identifierQuote,
          nextSeen,
        )})`;
      }
      const ref = quoted ? `${identifierQuote}${name}${identifierQuote}` : name;
      return alias ? `${alias}.${ref}` : ref;
    },
    identifierQuote,
  );
}

// Expand any virtual column references in a raw SQL fragment (e.g. a saved
// filter or ad-hoc sql_expr row filter) by replacing each virtual column id
// with its fully-resolved expression. Real-column-only fragments are returned
// unchanged (fast path when the fact table has no virtual columns).
export function expandVirtualColumnsInSql(
  sql: string,
  factTable: Pick<FactTableInterface, "columns">,
  identifierQuote: SqlIdentifierQuote = DEFAULT_IDENTIFIER_QUOTE,
): string {
  const virtualCols = factTable.columns.filter(
    (c) => c.isVirtual && c.sql && !c.deleted,
  );
  if (!virtualCols.length) return sql;

  return replaceSqlIdentifiers(
    sql,
    virtualCols.map((c) => c.column),
    (name) => {
      const c = virtualCols.find((v) => v.column === name);
      return c
        ? `(${resolveVirtualColumnSql(c, factTable, "", identifierQuote)})`
        : name;
    },
    identifierQuote,
  );
}

// Whether a SQL expression references a given column identifier. String
// literals and comments are skipped, so a name inside a string literal (e.g.
// `status = 'margin_vc'`) does not count as a reference, while a quoted
// identifier (per `identifierQuote`) does. Computed on demand — no dependency
// state is persisted.
export function sqlReferencesColumn(
  sql: string,
  column: string,
  identifierQuote: SqlIdentifierQuote = DEFAULT_IDENTIFIER_QUOTE,
): boolean {
  let found = false;
  replaceSqlIdentifiers(
    sql,
    [column],
    (name) => {
      found = true;
      return name;
    },
    identifierQuote,
  );
  return found;
}

export function getColumnExpression(
  column: string,
  factTable: Pick<FactTableInterface, "columns">,
  // todo: add stringification for dimension cols that may not be string type
  jsonExtract: (jsonCol: string, path: string, isNumeric: boolean) => string,
  alias: string = "",
  identifierQuote: SqlIdentifierQuote = DEFAULT_IDENTIFIER_QUOTE,
): string {
  // Virtual (computed) columns inline their stored SQL expression wherever they
  // are referenced (metric value SELECT, row-filter WHERE, slice WHERE, ...).
  // `!c.deleted` matches `expandVirtualColumnsInSql`: a soft-deleted virtual
  // column must not keep contributing its expression to generated SQL.
  const virtualCol = factTable.columns.find(
    (c) => c.column === column && c.isVirtual && c.sql && !c.deleted,
  );
  if (virtualCol?.sql) {
    return `(${resolveVirtualColumnSql(
      virtualCol,
      factTable,
      alias,
      identifierQuote,
    )})`;
  }

  const parts = column.split(".");
  if (parts.length > 1) {
    const col = factTable.columns.find((c) => c.column === parts[0]);
    if (col?.datatype === "json") {
      const path = parts.slice(1).join(".");

      const field = col.jsonFields?.[path];
      const isNumeric = field?.datatype === "number";

      return jsonExtract(
        alias ? `${alias}.${parts[0]}` : parts[0],
        path,
        isNumeric,
      );
    }
  }

  return alias ? `${alias}.${column}` : column;
}

export function getColumnRefWhereClause({
  factTable,
  columnRef,
  escapeStringLiteral,
  stringMatch,
  jsonExtract,
  evalBoolean,
  castToTimestamp,
  showSourceComment = false,
  sliceInfo,
  identifierQuote = DEFAULT_IDENTIFIER_QUOTE,
}: {
  factTable: Pick<FactTableInterface, "columns" | "filters" | "userIdTypes">;
  columnRef: ColumnRef;
  escapeStringLiteral: (s: string) => string;
  stringMatch: StringMatchFn;
  jsonExtract: (jsonCol: string, path: string, isNumeric: boolean) => string;
  evalBoolean: (col: string, value: boolean) => string;
  castToTimestamp?: (column: string) => string;
  showSourceComment?: boolean;
  sliceInfo?: SliceMetricInfo;
  identifierQuote?: SqlIdentifierQuote;
}): string[] {
  const where = new Set<string>();

  // First add slice filters if this is a slice metric
  if (sliceInfo?.isSliceMetric) {
    // Apply filters for each slice level
    sliceInfo.sliceLevels.forEach((sliceLevel) => {
      const sliceColumn = factTable.columns.find(
        (col) => col.column === sliceLevel.column,
      );

      if (sliceColumn && !sliceColumn.deleted) {
        const columnExpr = getColumnExpression(
          sliceLevel.column,
          factTable,
          jsonExtract,
          "",
          identifierQuote,
        );

        if (
          sliceLevel.levels.length === 0 ||
          (sliceColumn.datatype === "boolean" &&
            sliceLevel.levels[0] === "null")
        ) {
          // For "other" or "null", exclude all auto slice values
          if (sliceColumn.datatype === "boolean") {
            // For boolean "other"/"null", check for NULL values
            where.add(`(${columnExpr} IS NULL)`);
          } else if (
            sliceColumn.autoSlices &&
            sliceColumn.autoSlices.length > 0
          ) {
            const escapedValues = sliceColumn.autoSlices.map(
              (v: string) => "'" + escapeStringLiteral(v) + "'",
            );
            where.add(
              `(${columnExpr} NOT IN (\n  ${escapedValues.join(",\n  ")}\n))`,
            );
          }
        } else {
          // For specific auto slice values, filter to that value
          if (sliceColumn.datatype === "boolean") {
            const boolValue = stringToBoolean(sliceLevel.levels[0]);
            where.add(`(${evalBoolean(columnExpr, boolValue)})`);
            return;
          }

          where.add(
            `(${columnExpr} = '${escapeStringLiteral(sliceLevel.levels[0])}')`,
          );
        }
      }
    });
  }

  columnRef.rowFilters?.forEach((filter) => {
    const filterSQL = getRowFilterSQL({
      rowFilter: filter,
      factTable,
      jsonExtract,
      escapeStringLiteral,
      stringMatch,
      evalBoolean,
      castToTimestamp,
      showSourceComment,
      identifierQuote,
    });
    if (filterSQL) {
      where.add(filterSQL);
    }
  });

  return [...where];
}

/**
 * Normalize a stored `date`-column row-filter value into a timestamp literal
 * body the warehouse dialects can cast. Values are UTC wall-clock text, in any
 * of the spellings `isValidRowFilterDateValue` accepts: the date picker writes
 * `2024-01-01T17:00`, and an API caller can send `2024-01-01T17:00:00.000Z` or
 * `2024-01-01 17:00:00`. All of them reshape to `2024-01-01 17:00:00`; date-only
 * values (`2024-01-01`) pass through unchanged. This only rewrites the text —
 * dropping the `Z` does not shift the instant, because the value was never a
 * local-time instant to begin with.
 *
 * Minute-precision values are padded to whole seconds. `DateFilterInput` stores
 * `yyyy-MM-dd'T'HH:mm` (the native `datetime-local` shape), and strict dialects
 * reject that as a timestamp literal — ClickHouse fails the whole query with
 * "Cannot parse time component of DateTime 12:11". Seconds are the only missing
 * piece, so supply them rather than making callers store a wider format.
 *
 * Dropping the fractional part never loses information, because
 * `isValidRowFilterDateValue` only accepts an all-zero fraction — anything finer
 * than a second is rejected upstream rather than silently truncated here.
 */
export function normalizeRowFilterDateValue(value: string): string {
  const normalized = value
    .trim()
    .replace("T", " ")
    .replace(/\.\d+/, "")
    .replace(/Z$/, "")
    .trim();

  // Only pads `YYYY-MM-DD HH:MM`; a date-only value stays date-only so the
  // calendar-day handling in getRowFilterSQL keeps treating it as a whole day.
  return normalized.replace(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2})$/, "$1:00");
}

/**
 * Whether a `date`-column row-filter value is safe to cast to a timestamp.
 * Row filters can come from saved metrics or API callers (not just the date
 * picker), so we validate before emitting `CAST(<value> AS TIMESTAMP)` — an
 * unparseable literal like `foo` would fail the warehouse query. Accepts
 * `YYYY-MM-DD` optionally followed by a time (space or `T` separator, optional
 * seconds / trailing `Z`) that is also a real calendar date.
 *
 * A fractional-seconds part is accepted only when it is all zeros — the common
 * `Date.toISOString()` shape, where dropping it is lossless. Anything finer than
 * a second is rejected rather than truncated, because the comparison cannot honour
 * it: `castToTimestamp` targets second-precision types on some dialects
 * (ClickHouse `DateTime`, MySQL `DATETIME`) and is applied to the *column* as well
 * as the value, so a sub-second literal would be matched against a column already
 * truncated to whole seconds. Truncating the value silently moved the boundary by
 * up to a second; rejecting surfaces it as a filter that matches no rows instead.
 */
export function isValidRowFilterDateValue(value: string): boolean {
  const trimmed = value.trim();
  const match = trimmed.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d+))?Z?)?$/,
  );
  if (!match) {
    return false;
  }
  const [, year, month, day, hour = "0", minute = "0", second = "0", fraction] =
    match;
  if (fraction && /[^0]/.test(fraction)) {
    return false;
  }
  // `new Date(...)` silently normalizes out-of-range components (e.g. Feb 30
  // becomes Mar 1-2) instead of rejecting them, so confirm the parsed value
  // round-trips to the same components before trusting it.
  const date = new Date(
    Date.UTC(+year, +month - 1, +day, +hour, +minute, +second),
  );
  return (
    date.getUTCFullYear() === +year &&
    date.getUTCMonth() === +month - 1 &&
    date.getUTCDate() === +day &&
    date.getUTCHours() === +hour &&
    date.getUTCMinutes() === +minute &&
    date.getUTCSeconds() === +second
  );
}

/**
 * Whether a `date`-column row-filter value names a whole calendar day rather
 * than a precise instant (`2024-01-15` vs `2024-01-15 09:30`). The date-only
 * operators (`=`, `between`, `not_between`) store this shape, and API callers
 * can send it for any operator.
 */
export function isDateOnlyRowFilterValue(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}

/**
 * The exclusive end of the calendar day a date-only value names — i.e. the
 * following day at midnight. Used to expand day-level filters into half-open
 * `[day, nextDay)` intervals; see `getRowFilterSQL`.
 */
export function getRowFilterDateDayEnd(value: string): string {
  const [year, month, day] = value.trim().slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1))
    .toISOString()
    .slice(0, 10);
}

/**
 * Predicate that matches no rows. Used when a row filter is malformed: dropping
 * it instead would silently widen the result set, which is the more dangerous
 * failure for an analytics query (see `getRowFilterSQL`).
 */
const MATCH_NO_ROWS_SQL = "(1 = 0)";

export function getRowFilterSQL({
  rowFilter,
  factTable,
  jsonExtract,
  escapeStringLiteral,
  stringMatch,
  evalBoolean,
  castToTimestamp,
  showSourceComment = false,
  identifierQuote = DEFAULT_IDENTIFIER_QUOTE,
}: {
  rowFilter: RowFilter;
  factTable: Pick<FactTableInterface, "columns" | "filters" | "userIdTypes">;
  jsonExtract: (jsonCol: string, path: string, isNumeric: boolean) => string;
  escapeStringLiteral: (s: string) => string;
  stringMatch: StringMatchFn;
  evalBoolean: (col: string, value: boolean) => string;
  // Casts an expression to the dialect's TIMESTAMP type. When provided, `date`
  // columns compared with </<=/>/>=/=/!=/between/not_between/in/not_in cast both
  // the column and the value literal so the comparison is temporal (UTC) rather
  // than lexicographic.
  castToTimestamp?: (column: string) => string;
  showSourceComment?: boolean;
  identifierQuote?: SqlIdentifierQuote;
}): string | null {
  // Some operators do not require a column
  if (rowFilter.operator === "saved_filter") {
    const filter = factTable.filters.find(
      (f) => f.id === rowFilter.values?.[0],
    );
    if (filter) {
      const comment = showSourceComment ? `-- Filter: ${filter.name}\n` : "";
      return (
        comment +
        `(${expandVirtualColumnsInSql(filter.value, factTable, identifierQuote)})`
      );
    }
    return null;
  }
  if (rowFilter.operator === "sql_expr") {
    if (!rowFilter.values?.[0]) {
      return null;
    }
    return `(${expandVirtualColumnsInSql(
      rowFilter.values?.[0] || "",
      factTable,
      identifierQuote,
    )})`;
  }

  if (!rowFilter.column) {
    return null;
  }
  const columnExpr = getColumnExpression(
    rowFilter.column,
    factTable,
    jsonExtract,
    "",
    identifierQuote,
  );
  const columnType = getSelectedColumnDatatype({
    factTable,
    column: rowFilter.column,
  });

  // If a boolean column is using equals operator, convert to is_true/is_false
  let operator = rowFilter.operator;
  if (
    operator === "=" &&
    rowFilter.values?.[0] === "true" &&
    columnType === "boolean"
  ) {
    operator = "is_true";
  }
  if (
    operator === "=" &&
    rowFilter.values?.[0] === "false" &&
    columnType === "boolean"
  ) {
    operator = "is_false";
  }

  // Some operators do not require values
  if (operator === "is_null") {
    return `(${columnExpr} IS NULL)`;
  }
  if (operator === "not_null") {
    return `(${columnExpr} IS NOT NULL)`;
  }
  if (operator === "is_true") {
    return `(${evalBoolean(columnExpr, true)})`;
  }
  if (operator === "is_false") {
    return `(${evalBoolean(columnExpr, false)})`;
  }

  if (!rowFilter.values?.length) {
    return null;
  }
  // Date columns compare as UTC timestamps (temporal) rather than as quoted
  // strings (lexicographic), when the dialect provides a timestamp cast.
  const castDates = columnType === "date" && !!castToTimestamp;

  let filterValues = rowFilter.values;
  if (castDates) {
    // Row filters reach here from saved metrics and API callers, not just the
    // date picker, so the values can't be trusted to be castable — `CAST('foo'
    // AS TIMESTAMP)` would fail the warehouse query. Two different situations,
    // handled differently:
    //   - Blank value: nothing has been entered yet (the pickers clear to `[]`,
    //     but a range keeps the untouched side as ""). Treat it as absent.
    //   - Non-blank but unparseable: the filter is malformed. Match no rows
    //     rather than dropping the predicate — omitting it would silently
    //     *widen* the result set, so a broken filter would quietly report more
    //     conversions instead of surfacing the problem.
    const provided = rowFilter.values.filter((v) => v.trim());
    if (!provided.length) {
      return null;
    }
    if (!provided.every((v) => isValidRowFilterDateValue(v))) {
      return MATCH_NO_ROWS_SQL;
    }
    filterValues = provided;
  }
  if (!filterValues.length) {
    return null;
  }

  const escapeValue = (v: string): string => {
    // Number, don't wrap in quotes
    if (columnType === "number" && v.match(/^-?(\d+|\d*\.\d+)$/)) {
      return v;
    }

    if (castDates && castToTimestamp) {
      return castToTimestamp(
        "'" + escapeStringLiteral(normalizeRowFilterDateValue(v)) + "'",
      );
    }

    return "'" + escapeStringLiteral(v) + "'";
  };

  // De-dupe on the escaped form (two spellings of the same instant collapse to
  // one literal) while keeping the raw value, which the date-only handling below
  // still needs.
  const uniqueValues = [
    ...new Map(filterValues.map((v) => [escapeValue(v), v])).values(),
  ];
  const escapedValues = uniqueValues.map(escapeValue);

  const firstValue = uniqueValues[0];
  const firstEscapedValue = escapedValues[0];

  // For date comparisons, cast the column so both sides are timestamps
  const comparisonColumn =
    castDates && castToTimestamp ? castToTimestamp(columnExpr) : columnExpr;

  // A `yyyy-MM-dd` value names a calendar day, not the instant at its midnight.
  // Against a timestamp column, comparing to that instant directly means
  // `= '2024-01-15'` only matches rows stamped exactly 00:00:00, and a range
  // ending on `2024-01-15` excludes all but that same first instant of the day.
  // Expand day-level values into the half-open interval [day, nextDay) so the
  // SQL matches the calendar-day semantics the pickers present.
  const isDayValue = (v: string) => castDates && isDateOnlyRowFilterValue(v);
  const escapedDayEnd = (v: string) => escapeValue(getRowFilterDateDayEnd(v));

  // Matches rows falling on/at the value: the whole day for a day-level value,
  // the exact instant otherwise.
  const equalsValue = (v: string) =>
    isDayValue(v)
      ? `${comparisonColumn} >= ${escapeValue(v)} AND ${comparisonColumn} < ${escapedDayEnd(v)}`
      : `${comparisonColumn} = ${escapeValue(v)}`;

  // Convert single-value in/not_in to =/!=
  if (escapedValues.length === 1) {
    if (operator === "in") {
      operator = "=";
    } else if (operator === "not_in") {
      operator = "!=";
    }
  }

  // Handle remaining operators
  switch (operator) {
    case "=":
      return `(${equalsValue(firstValue)})`;
    case "!=":
      return isDayValue(firstValue)
        ? `(NOT (${equalsValue(firstValue)}))`
        : `(${comparisonColumn} != ${firstEscapedValue})`;
    case "<":
    case ">=":
      // Already the start of the day, so day-level values need no adjustment.
      return `(${comparisonColumn} ${operator} ${firstEscapedValue})`;
    case "<=":
    case ">":
      // Inclusive/exclusive of the *end* of a day-level value.
      return isDayValue(firstValue)
        ? `(${comparisonColumn} ${operator === "<=" ? "<" : ">="} ${escapedDayEnd(firstValue)})`
        : `(${comparisonColumn} ${operator} ${firstEscapedValue})`;
    case "between":
    case "not_between": {
      // A range has a lower and an upper bound, but a user can leave one side
      // empty. Rather than silently dropping the whole filter (which would look
      // active in the UI while matching nothing), degrade a single-bound range
      // to the equivalent open-ended comparison. Read the bounds positionally
      // from `rowFilter.values` — `filterValues` collapses empties and loses
      // which side was set. Blank is the only "absent" case here: an
      // unparseable date bound already returned MATCH_NO_ROWS_SQL above rather
      // than being treated as an unset side.
      const boundUsable = (v: string | undefined): v is string => !!v?.trim();
      const lower = rowFilter.values[0];
      const upper = rowFilter.values[1];
      const hasLower = boundUsable(lower);
      const hasUpper = boundUsable(upper);
      const negated = operator === "not_between";

      // The upper bound is inclusive, so a day-level bound has to run to the
      // end of that day rather than stopping at its midnight — expressed as an
      // exclusive `<` against the following midnight.
      const atOrBeforeUpper = (v: string) =>
        isDayValue(v)
          ? `${comparisonColumn} < ${escapedDayEnd(v)}`
          : `${comparisonColumn} <= ${escapeValue(v)}`;
      const afterUpper = (v: string) =>
        isDayValue(v)
          ? `${comparisonColumn} >= ${escapedDayEnd(v)}`
          : `${comparisonColumn} > ${escapeValue(v)}`;

      if (hasLower && hasUpper) {
        // SQL BETWEEN is inclusive on both ends, so it only works when the
        // upper bound is a single instant; a day-level bound needs the
        // exclusive next-midnight form spelled out.
        if (!isDayValue(upper)) {
          return `(${comparisonColumn} ${negated ? "NOT " : ""}BETWEEN ${escapeValue(lower)} AND ${escapeValue(upper)})`;
        }
        return negated
          ? `(${comparisonColumn} < ${escapeValue(lower)} OR ${afterUpper(upper)})`
          : `(${comparisonColumn} >= ${escapeValue(lower)} AND ${atOrBeforeUpper(upper)})`;
      }
      if (hasLower) {
        // between [lower, ∞) → >=  ;  not_between → <
        return `(${comparisonColumn} ${negated ? "<" : ">="} ${escapeValue(lower)})`;
      }
      if (hasUpper) {
        // between (-∞, upper] → <=  ;  not_between → >
        return `(${negated ? afterUpper(upper) : atOrBeforeUpper(upper)})`;
      }
      return null;
    }
    case "in":
    case "not_in": {
      // Day-level values each cover a whole day, so they can't be listed as
      // scalars in an IN list — expand to a disjunction of day ranges.
      if (uniqueValues.some(isDayValue)) {
        const anyMatch = uniqueValues
          .map((v) => `(${equalsValue(v)})`)
          .join(" OR ");
        return operator === "in" ? `(${anyMatch})` : `(NOT (${anyMatch}))`;
      }
      const list = `(\n  ${escapedValues.join(",\n  ")}\n)`;
      return operator === "in"
        ? `(${comparisonColumn} IN ${list})`
        : `(${comparisonColumn} NOT IN ${list})`;
    }
    case "starts_with":
    case "ends_with":
    case "contains":
    case "not_contains":
      return `(${stringMatch(columnExpr, operator, rowFilter.values[0])})`;

    // IMPORTANT: no default to ensure missing cases are caught by the compiler
  }
}

export function getAggregateFilters({
  columnRef,
  column,
  ignoreInvalid = false,
}: {
  columnRef: Pick<
    ColumnRef,
    "aggregateFilter" | "aggregateFilterColumn" | "column"
  > | null;
  column: string;
  ignoreInvalid?: boolean;
}) {
  if (!columnRef?.aggregateFilter) return [];
  if (!columnRef.aggregateFilterColumn) return [];

  // Only support distinctUsers for now
  if (columnRef.column !== "$$distinctUsers") return [];

  const parts = columnRef.aggregateFilter.replace(/\s*/g, "").split(",");

  const filters: string[] = [];
  parts.forEach((part) => {
    if (!part) return;

    // i.e. ">10" or "!=5.1"
    const match = part.match(/^(=|!=|<>|<|<=|>|>=)(\d+(\.\d+)?)$/);
    if (match) {
      const [, operator, value] = match;
      filters.push(`${column} ${operator} ${value}`);
    } else if (!ignoreInvalid) {
      throw new Error(`Invalid user filter: ${part}`);
    }
  });

  return filters;
}

export function getFactTableTemplateVariables(
  factTable: FactTableInterface,
): TemplateVariables {
  return {
    eventName: factTable.eventName,
  };
}

// TODO(sql): refactor to remove factTableMap
export function getMetricTemplateVariables(
  m: ExperimentMetricInterface,
  factTableMap: FactTableMap,
  useDenominator?: boolean,
): TemplateVariables {
  if (isFactMetric(m)) {
    const factTableId = useDenominator
      ? m.denominator?.factTableId
      : getFactMetricPrimaryFactTableId(m);
    if (!factTableId) return {};

    const factTable = factTableMap.get(factTableId);
    if (!factTable) return {};

    return {
      eventName: factTable.eventName,
    };
  }

  return m.templateVariables || {};
}

export function isCappableMetricType(m: ExperimentMetricDefinition) {
  return !quantileMetricType(m) && !isBinomialMetric(m);
}

export function isBinomialMetric(m: ExperimentMetricDefinition) {
  if (isFactMetric(m))
    return ["proportion", "retention", "funnel"].includes(m.metricType);
  return m.type === "binomial";
}

/**
 * Fact table the metric's primary events come from: the numerator's for most
 * metric types, the first step's for funnels (which have no numerator).
 */
export function getFactMetricPrimaryFactTableId(
  m: FactMetricInterface,
): string {
  return isFactFunnelMetric(m)
    ? (m.funnelSettings.steps[0]?.factTableId ?? "")
    : m.numerator.factTableId;
}

/**
 * Every ColumnRef the metric reads from, for dependency scans over fact table
 * columns and filters. Funnel steps have no column of their own, so they are
 * surfaced as column-less refs that still carry their row filters.
 */
export function getFactMetricColumnRefs(m: FactMetricInterface): ColumnRef[] {
  if (isFactFunnelMetric(m)) {
    return m.funnelSettings.steps.map((step) => ({
      factTableId: step.factTableId,
      column: "",
      rowFilters: step.rowFilters,
    }));
  }
  return m.denominator ? [m.numerator, m.denominator] : [m.numerator];
}

export function isRetentionMetric(m: ExperimentMetricDefinition) {
  return isFactMetric(m) && m.metricType === "retention";
}

export function isRatioMetric(
  m: ExperimentMetricDefinition,
  denominatorMetric?: ExperimentMetricDefinition,
): boolean {
  if (isFactMetric(m)) return m.metricType === "ratio";
  return !!denominatorMetric && !isBinomialMetric(denominatorMetric);
}

export function quantileMetricType(
  m: ExperimentMetricDefinition,
): "" | MetricQuantileSettings["type"] {
  if (isFactMetric(m) && m.metricType === "quantile") {
    return m.quantileSettings?.type || "";
  }
  return "";
}

/**
 * LEGACY funnel metric: a non-fact metric whose (binomial) denominator metric
 * gates the numerator (denominator chaining). This is NOT the new fact-metric
 * funnel type — see isFactFunnelMetric.
 */
export function isLegacyFunnelMetric(
  m: ExperimentMetricDefinition,
  denominatorMetric?: ExperimentMetricDefinition,
): boolean {
  if (isFactMetric(m)) return false;
  return !!denominatorMetric && isBinomialMetric(denominatorMetric);
}

/**
 * fact-metric funnel: a fact metric with metricType === "funnel"
 */
export function isFactFunnelMetric(
  m: ExperimentMetricDefinition,
): m is FunnelFactMetricInterface {
  return isFactMetric(m) && m.metricType === "funnel";
}

export function isRegressionAdjusted(
  m: ExperimentMetricDefinition,
  denominatorMetric?: ExperimentMetricDefinition,
) {
  const isLegacyRatioMetric: boolean =
    isRatioMetric(m, denominatorMetric) && !isFactMetric(m);
  return (
    (m.regressionAdjustmentDays ?? 0) > 0 &&
    !!m.regressionAdjustmentEnabled &&
    !isLegacyRatioMetric &&
    !quantileMetricType(m)
  );
}

/**
 * The optional independent lower-tail capping settings. Only fact metrics
 * support a lower tail; legacy metrics never have this field.
 */
export function getLowerCappingSettings(metric: ExperimentMetricDefinition) {
  return "lowerCappingSettings" in metric
    ? metric.lowerCappingSettings
    : undefined;
}

export function isUpperPercentileCappedMetric(
  metric: ExperimentMetricDefinition,
) {
  return (
    getCappingTailState(metric.cappingSettings).upperPercentileCapped &&
    isCappableMetricType(metric)
  );
}

/**
 * Legacy alias for upper-tail percentile capping. The legacy (non-fact)
 * experiment SQL path only supports upper-tail capping, so this maps to the
 * upper tail.
 */
export function isPercentileCappedMetric(metric: ExperimentMetricDefinition) {
  return isUpperPercentileCappedMetric(metric);
}

/** Lower-tail percentile winsorization (e.g. 5th percentile floor). */
export function isLowerPercentileCappedMetric(
  metric: ExperimentMetricDefinition,
) {
  return (
    getCappingTailState(undefined, getLowerCappingSettings(metric))
      .lowerPercentileCapped && isCappableMetricType(metric)
  );
}

/** True if SQL needs a percentile subquery (upper and/or lower tail). */
export function needsPercentileCapSubquery(metric: ExperimentMetricInterface) {
  const t = getCappingTailState(
    metric.cappingSettings,
    getLowerCappingSettings(metric),
  );
  return (
    (t.upperPercentileCapped || t.lowerPercentileCapped) &&
    isCappableMetricType(metric)
  );
}

export function isAbsoluteCappedMetric(metric: ExperimentMetricDefinition) {
  return (
    getCappingTailState(metric.cappingSettings).upperAbsoluteCapped &&
    isCappableMetricType(metric)
  );
}

export function isLowerAbsoluteCappedMetric(
  metric: ExperimentMetricDefinition,
) {
  return (
    getCappingTailState(undefined, getLowerCappingSettings(metric))
      .lowerAbsoluteCapped && isCappableMetricType(metric)
  );
}

/** Any upper or lower tail capping is active (SQL / experiment analysis). */
export function hasActiveCappingTails(metric: ExperimentMetricDefinition) {
  return (
    getCappingTailState(metric.cappingSettings, getLowerCappingSettings(metric))
      .anyCap && isCappableMetricType(metric)
  );
}

export function isSliceMetric(metric: ExperimentMetricDefinition) {
  return parseSliceMetricId(metric.id).isSliceMetric;
}

export function eligibleForUncappedMetric(metric: ExperimentMetricDefinition) {
  return (
    (isUpperPercentileCappedMetric(metric) ||
      isLowerPercentileCappedMetric(metric) ||
      isAbsoluteCappedMetric(metric) ||
      isLowerAbsoluteCappedMetric(metric)) &&
    !isSliceMetric(metric)
  );
}

export function getMetricWindowHours(
  windowSettings: MetricWindowSettings,
): number {
  const value = windowSettings.windowValue;
  if (windowSettings.windowUnit === "minutes") return value / 60;
  if (windowSettings.windowUnit === "hours") return value;
  if (windowSettings.windowUnit === "days") return value * 24;
  if (windowSettings.windowUnit === "weeks") return value * 24 * 7;

  return 72;
}

export function getDelayWindowHours(
  windowSettings: MetricWindowSettings,
): number {
  const value = windowSettings.delayValue;
  if (windowSettings.delayUnit === "minutes") return value / 60;
  if (windowSettings.delayUnit === "hours") return value;
  if (windowSettings.delayUnit === "days") return value * 24;
  if (windowSettings.delayUnit === "weeks") return value * 24 * 7;

  return 0;
}

export function getSelectedColumnDatatype({
  factTable,
  column,
  excludeDeleted = false,
}: {
  factTable: Pick<FactTableInterface, "columns"> | null;
  column: string;
  excludeDeleted?: boolean;
}): FactTableColumnType | undefined {
  if (!factTable) return undefined;

  // Might be a JSON column, look at nested field
  const parts = column.split(".");
  if (parts.length > 1) {
    const col = factTable.columns.find((c) => c.column === parts[0]);
    if (col?.datatype === "json" && (!excludeDeleted || !col?.deleted)) {
      const field = col.jsonFields?.[parts.slice(1).join(".")];
      if (field) {
        return field.datatype;
      }
    }
  }

  const col = factTable.columns.find((c) => c.column === column);
  if (excludeDeleted && (!col || col.deleted)) return undefined;

  return col?.datatype;
}

export function getUserIdTypes(
  metric: ExperimentMetricDefinition,
  factTableMap: FactTableDefinitionMap,
  useDenominator?: boolean,
): string[] {
  if (isFactMetric(metric)) {
    const factTable = factTableMap.get(
      useDenominator
        ? metric.denominator?.factTableId || ""
        : getFactMetricPrimaryFactTableId(metric),
    );
    return factTable?.userIdTypes || [];
  }

  return metric.userIdTypes || [];
}

export interface SliceMetricInfo {
  isSliceMetric: boolean;
  baseMetricId: string;
  sliceLevels: SliceLevelsData[];
}

/**
 * Parses a slice query string (e.g., "dim:browser=Chrome&dim:country=AU")
 * and returns the slice levels with datatypes.
 */
export function parseSliceQueryString(
  queryString: string,
  factTableMap?: Record<string, FactTableDefinition>,
): SliceLevelsData[] {
  const sliceLevels: SliceLevelsData[] = [];
  const params = new URLSearchParams(queryString);

  for (const [key, value] of params.entries()) {
    if (key.startsWith("dim:")) {
      // URLSearchParams already percent-decodes keys and values
      const column = key.substring(4); // Remove 'dim:' prefix
      const level = value === "" ? null : value;
      // Look up datatype from factTableMap if available
      let datatype: "string" | "boolean" = "string";
      if (factTableMap) {
        for (const factTable of Object.values(factTableMap)) {
          const columnInfo = factTable.columns.find(
            (col) => col.column === column,
          );
          if (columnInfo) {
            datatype = columnInfo.datatype === "boolean" ? "boolean" : "string";
            break;
          }
        }
      }

      sliceLevels.push({
        column: column,
        datatype,
        levels: level ? [level] : [],
      });
    }
  }

  return sliceLevels;
}

export function isSliceTagSelectAll(tagId: string): {
  isSelectAll: boolean;
  column?: string;
} {
  // Handle "select all" format: dim:column (no equals sign)
  if (!tagId.includes("=")) {
    const columnMatch = tagId.match(/^dim:(.+)$/);
    if (columnMatch) {
      return {
        isSelectAll: true,
        column: decodeURIComponent(columnMatch[1]),
      };
    }
  }
  return { isSelectAll: false };
}

export function parseSliceMetricId(
  metricId: string,
  factTableMap?: Record<string, FactTableDefinition>,
): SliceMetricInfo {
  const questionMarkIndex = metricId.indexOf("?");
  if (questionMarkIndex === -1) {
    return {
      isSliceMetric: false,
      baseMetricId: metricId,
      sliceLevels: [],
    };
  }

  const baseMetricId = metricId.substring(0, questionMarkIndex);
  const queryString = metricId.substring(questionMarkIndex + 1);

  const sliceLevels = parseSliceQueryString(queryString, factTableMap);

  if (sliceLevels.length === 0) {
    return {
      isSliceMetric: false,
      baseMetricId,
      sliceLevels: [],
    };
  }

  return {
    isSliceMetric: true,
    baseMetricId,
    sliceLevels: sliceLevels,
  };
}

export interface FunnelStepMetricInfo {
  isFunnelStepMetric: boolean;
  baseMetricId: string;
  stepIndex: number | null;
}

/**
 * Id of the ephemeral binomial metric representing "did the unit reach step k".
 * These never exist as saved fact metrics; the stats-engine packaging layer
 * mints them when it splits a funnel's multi-column query block, and results,
 * snapshots, and time series are keyed by them.
 */
export function funnelStepMetricId(
  baseMetricId: string,
  stepIndex: number,
): string {
  return `${baseMetricId}?step=${stepIndex}`;
}

export function parseFunnelStepMetricId(
  metricId: string,
): FunnelStepMetricInfo {
  const match = metricId.match(/^(.+)\?step=(\d+)$/);
  if (!match) {
    return {
      isFunnelStepMetric: false,
      baseMetricId: metricId,
      stepIndex: null,
    };
  }
  return {
    isFunnelStepMetric: true,
    baseMetricId: match[1],
    stepIndex: parseInt(match[2], 10),
  };
}

/**
 * One proportion metric per funnel step, cloned from the parent funnel. Each
 * counts the units that reached that step, so the step's own fact table and row
 * filters become an ordinary `$$distinctUsers` numerator.
 *
 * These are never queried — the parent funnel is queried once and its result
 * block split per step (see `splitFunnelMetricBlock`). They exist so step ids
 * resolve to a real definition for names, snapshot settings, and result
 * lookups, the same way slice metrics do.
 *
 * Note: you cannot use these metrics to generate SQL standalone, as the condition
 * for which units reach that step of the funnel are not contained in this metric
 * definition.
 */
export function getFunnelStepMetrics(
  metric: FunnelFactMetricInterface,
): StandardFactMetricInterface[] {
  return metric.funnelSettings.steps.map((step, stepIndex) => ({
    ...metric,
    id: funnelStepMetricId(metric.id, stepIndex),
    name: `${metric.name}: ${step.name}`,
    description: `Units reaching "${step.name}" in the ${metric.name} funnel.`,
    metricType: "proportion" as const,
    numerator: {
      factTableId: step.factTableId,
      column: "$$distinctUsers",
      rowFilters: step.rowFilters,
    },
    denominator: null,
    funnelSettings: null,
  }));
}

/**
 * A single funnel step metric, or null when the step no longer exists: results
 * and snapshots outlive edits that remove a step.
 */
export function getFunnelStepMetric(
  metric: FunnelFactMetricInterface,
  stepIndex: number,
): StandardFactMetricInterface | null {
  return getFunnelStepMetrics(metric)[stepIndex] ?? null;
}

export function dedupeMetricIdsPreserveOrder(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Ordered base (non-slice) metric ids that lie in both the subset and the superset.
 * Walks `supersetMetricIds` in order, skips slice rows (`base?dim:...`), and keeps
 * each non-slice id whose base appears in `subsetMetricIds` (slice entries in the
 * subset only affect which parent base is in-category). If `supersetMetricIds` is
 * empty, returns subset ids with slice entries removed (deduped, order preserved).
 */
export function getIntersectionBaseMetricIds(
  subsetMetricIds: string[],
  supersetMetricIds: string[],
): string[] {
  if (!supersetMetricIds.length) {
    return dedupeMetricIdsPreserveOrder(
      subsetMetricIds.filter((id) => !parseSliceMetricId(id).isSliceMetric),
    );
  }
  const out: string[] = [];
  const seen = new Set<string>();
  const subsetBases = new Set(
    subsetMetricIds.map((id) => parseSliceMetricId(id).baseMetricId),
  );
  for (const id of supersetMetricIds) {
    if (parseSliceMetricId(id).isSliceMetric) {
      continue;
    }
    if (!subsetBases.has(id)) {
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function getMetricLink(id: string): string {
  if (isFactMetricId(id)) return `/fact-metrics/${id}`;
  return `/metric/${id}`;
}

export function getMetricSnapshotSettings<
  T extends ExperimentMetricDefinition,
>({
  metric,
  denominatorMetrics,
  experimentRegressionAdjustmentEnabled,
  organizationSettings,
  metricOverrides,
}: {
  metric: T;
  denominatorMetrics: MetricDefinitionInterface[];
  experimentRegressionAdjustmentEnabled: boolean;
  organizationSettings?: Partial<OrganizationSettings>; // can be RA and prior settings from a snapshot of org settings
  metricOverrides?: MetricOverride[];
}): {
  newMetric: T;
  denominatorMetrics: MetricDefinitionInterface[];
  metricSnapshotSettings: MetricSnapshotSettings;
} {
  const newMetric = cloneDeep<T>(metric);

  // start with default RA settings
  let regressionAdjustmentAvailable = true;
  let regressionAdjustmentEnabled = false;
  let regressionAdjustmentDays = DEFAULT_REGRESSION_ADJUSTMENT_DAYS;
  let regressionAdjustmentReason = "";

  // get RA settings from organization
  if (organizationSettings?.regressionAdjustmentEnabled) {
    regressionAdjustmentEnabled = true;
    regressionAdjustmentDays =
      organizationSettings?.regressionAdjustmentDays ??
      regressionAdjustmentDays;
  }
  if (experimentRegressionAdjustmentEnabled) {
    regressionAdjustmentEnabled = true;
  }

  // get RA settings from metric
  if (metric?.regressionAdjustmentOverride) {
    regressionAdjustmentEnabled = !!metric?.regressionAdjustmentEnabled;
    regressionAdjustmentDays =
      metric?.regressionAdjustmentDays ?? DEFAULT_REGRESSION_ADJUSTMENT_DAYS;
    if (!regressionAdjustmentEnabled) {
      regressionAdjustmentAvailable = false;
      regressionAdjustmentReason = "disabled in metric settings";
    }
  }

  // experiment kill switch
  if (!experimentRegressionAdjustmentEnabled) {
    regressionAdjustmentEnabled = false;
    regressionAdjustmentAvailable = true;
    regressionAdjustmentReason = "disabled in experiment";
  }

  // start with default prior settings
  const metricPriorSettings = {
    properPrior: false,
    properPriorMean: 0,
    properPriorStdDev: DEFAULT_PROPER_PRIOR_STDDEV,
  };

  // get prior settings from organization
  if (organizationSettings?.metricDefaults?.priorSettings) {
    metricPriorSettings.properPrior =
      organizationSettings.metricDefaults.priorSettings.proper;
    metricPriorSettings.properPriorMean =
      organizationSettings.metricDefaults.priorSettings.mean;
    metricPriorSettings.properPriorStdDev =
      organizationSettings.metricDefaults.priorSettings.stddev;
  }

  // get prior settings from metric
  if (metric.priorSettings.override) {
    metricPriorSettings.properPrior = metric.priorSettings.proper;
    metricPriorSettings.properPriorMean = metric.priorSettings.mean;
    metricPriorSettings.properPriorStdDev = metric.priorSettings.stddev;
  }

  // get RA and prior settings from metric override
  if (metricOverrides) {
    // For slice metrics, use the base metric ID for lookups
    const { baseMetricId } = parseSliceMetricId(metric.id);
    const metricOverride = metricOverrides.find((mo) => mo.id === baseMetricId);

    // RA override
    if (metricOverride?.regressionAdjustmentOverride) {
      regressionAdjustmentEnabled =
        !!metricOverride?.regressionAdjustmentEnabled;
      regressionAdjustmentDays =
        metricOverride?.regressionAdjustmentDays ?? regressionAdjustmentDays;
      if (!regressionAdjustmentEnabled) {
        regressionAdjustmentAvailable = false;
        if (!metric.regressionAdjustmentEnabled) {
          regressionAdjustmentReason =
            "disabled in metric settings and metric override";
        } else {
          regressionAdjustmentReason = "disabled by metric override";
        }
      } else {
        regressionAdjustmentAvailable = true;
        regressionAdjustmentReason = "";
      }
    }

    // prior override
    if (metricOverride?.properPriorOverride) {
      metricPriorSettings.properPrior =
        metricOverride?.properPriorEnabled ?? metricPriorSettings.properPrior;
      metricPriorSettings.properPriorMean =
        metricOverride?.properPriorMean ?? metricPriorSettings.properPriorMean;
      metricPriorSettings.properPriorStdDev =
        metricOverride?.properPriorStdDev ??
        metricPriorSettings.properPriorStdDev;
    }
  }

  // final gatekeeping for RA
  if (regressionAdjustmentEnabled) {
    if (metric && isFactMetric(metric) && quantileMetricType(metric)) {
      // is this a fact quantile metric?
      regressionAdjustmentEnabled = false;
      regressionAdjustmentAvailable = false;
      regressionAdjustmentReason = "quantile metrics not supported";
    }
    if (metric?.denominator) {
      // is this a classic "ratio" metric (denominator unsupported type)?
      const denominator = denominatorMetrics.find(
        (m) => m.id === metric?.denominator,
      );
      if (denominator && !isBinomialMetric(denominator)) {
        regressionAdjustmentEnabled = false;
        regressionAdjustmentAvailable = false;
        regressionAdjustmentReason = `denominator is ${denominator.type}. CUPED available for ratio metrics only if based on fact tables.`;
      }
    }
    if (metric && !isFactMetric(metric) && metric?.aggregation) {
      regressionAdjustmentEnabled = false;
      regressionAdjustmentAvailable = false;
      regressionAdjustmentReason = "custom aggregation";
    }
    // The funnel SQL does not emit covariate columns yet, so neither the funnel
    // nor its per-step proportions can be regression adjusted. Gating both here
    // keeps the snapshot settings honest about what the query computed.
    if (
      isFactFunnelMetric(metric) ||
      parseFunnelStepMetricId(metric.id).isFunnelStepMetric
    ) {
      regressionAdjustmentEnabled = false;
      regressionAdjustmentAvailable = false;
      regressionAdjustmentReason = "funnel metrics not supported";
    }
  }

  regressionAdjustmentDays = regressionAdjustmentEnabled
    ? regressionAdjustmentDays
    : 0;

  newMetric.regressionAdjustmentEnabled = regressionAdjustmentEnabled;
  newMetric.regressionAdjustmentDays = regressionAdjustmentDays;

  return {
    newMetric,
    denominatorMetrics,
    metricSnapshotSettings: {
      metric: newMetric.id,
      ...metricPriorSettings,
      regressionAdjustmentEnabled,
      regressionAdjustmentAvailable,
      regressionAdjustmentDays,
      regressionAdjustmentReason,
    },
  };
}

export function getAllMetricSettingsForSnapshot({
  allExperimentMetrics,
  denominatorMetrics,
  orgSettings,
  experimentRegressionAdjustmentEnabled,
  experimentMetricOverrides = [],
  datasourceType,
  hasRegressionAdjustmentFeature,
}: {
  allExperimentMetrics: (ExperimentMetricDefinition | null)[];
  denominatorMetrics: MetricInterface[];
  orgSettings: OrganizationSettings;
  experimentRegressionAdjustmentEnabled?: boolean;
  experimentMetricOverrides?: MetricOverride[];
  datasourceType?: DataSourceInterfaceWithParams["type"];
  hasRegressionAdjustmentFeature: boolean;
}) {
  const settingsForSnapshotMetrics: MetricSnapshotSettings[] = [];
  let regressionAdjustmentAvailable = true;
  let regressionAdjustmentEnabled = true;
  let regressionAdjustmentHasValidMetrics = false;
  if (allExperimentMetrics.length === 0) {
    regressionAdjustmentHasValidMetrics = true; // avoid awkward UI warning
  }
  for (const metric of allExperimentMetrics) {
    if (!metric) continue;
    const { metricSnapshotSettings } = getMetricSnapshotSettings({
      metric: metric,
      denominatorMetrics: denominatorMetrics,
      experimentRegressionAdjustmentEnabled:
        experimentRegressionAdjustmentEnabled ??
        DEFAULT_REGRESSION_ADJUSTMENT_ENABLED,
      organizationSettings: orgSettings,
      metricOverrides: experimentMetricOverrides,
    });
    if (metricSnapshotSettings.regressionAdjustmentEnabled) {
      regressionAdjustmentEnabled = true;
    }
    if (metricSnapshotSettings.regressionAdjustmentAvailable) {
      regressionAdjustmentHasValidMetrics = true;
    }
    settingsForSnapshotMetrics.push(metricSnapshotSettings);
  }
  if (!experimentRegressionAdjustmentEnabled) {
    regressionAdjustmentEnabled = false;
  }
  if (
    !datasourceType ||
    datasourceType === "google_analytics" ||
    datasourceType === "mixpanel"
  ) {
    regressionAdjustmentAvailable = false;
    regressionAdjustmentEnabled = false;
  }
  if (!hasRegressionAdjustmentFeature) {
    regressionAdjustmentEnabled = false;
  }
  return {
    regressionAdjustmentAvailable,
    regressionAdjustmentEnabled,
    regressionAdjustmentHasValidMetrics,
    settingsForSnapshotMetrics,
  };
}

export function isExpectedDirection(
  stats: SnapshotMetric,
  metric: { inverse?: boolean },
): boolean {
  const expected: number = stats?.expected ?? 0;
  if (metric.inverse) {
    return expected < 0;
  }
  return expected > 0;
}

export function isStatSig(pValue: number, pValueThreshold: number): boolean {
  return pValue < pValueThreshold;
}

export function shouldHighlight({
  metric,
  baseline,
  stats,
  hasEnoughData,
  belowMinChange,
}: {
  metric: { id: string };
  baseline: SnapshotMetric;
  stats: SnapshotMetric;
  hasEnoughData: boolean;
  belowMinChange: boolean;
}): boolean {
  return !!(
    metric &&
    baseline?.value &&
    stats?.value &&
    hasEnoughData &&
    !belowMinChange
  );
}

export function getMetricSampleSize(
  baseline: SnapshotMetric,
  stats: SnapshotMetric,
  metric: ExperimentMetricDefinition,
): { baselineValue?: number; variationValue?: number } {
  return quantileMetricType(metric)
    ? {
        baselineValue: baseline?.stats?.count,
        variationValue: stats?.stats?.count,
      }
    : { baselineValue: baseline.value, variationValue: stats.value };
}

export function hasEnoughData(
  baseline: SnapshotMetric,
  stats: SnapshotMetric,
  metric: ExperimentMetricDefinition,
  metricDefaults: MetricDefaults,
): boolean {
  const { baselineValue, variationValue } = getMetricSampleSize(
    baseline,
    stats,
    metric,
  );
  if (!baselineValue || !variationValue) return false;

  const minSampleSize =
    metric.minSampleSize ?? metricDefaults.minimumSampleSize ?? 0;

  return Math.max(baselineValue, variationValue) >= minSampleSize;
}

export function isSuspiciousUplift(
  baseline: SnapshotMetric,
  stats: SnapshotMetric,
  metric: { maxPercentChange?: number },
  metricDefaults: MetricDefaults,
  differenceType: DifferenceType,
): boolean {
  if (!baseline?.cr || !stats?.cr || !stats?.expected) return false;

  const maxPercentChange =
    metric.maxPercentChange ?? metricDefaults?.maxPercentageChange ?? 0;

  if (differenceType === "relative") {
    return Math.abs(stats.expected) >= maxPercentChange;
  } else if (differenceType === "absolute") {
    return (
      Math.abs(stats.expected ?? 0) / Math.abs(baseline.cr) >= maxPercentChange
    );
  } else {
    // This means scaled impact could show up as suspicious even when
    // it doesn't show up for other difference types if CUPED is applied
    // and CUPED causes the value to cross the threshold
    return (
      Math.abs(stats.cr - baseline.cr) / Math.abs(baseline.cr) >=
      maxPercentChange
    );
  }
}

export function isBelowMinChange(
  baseline: SnapshotMetric,
  stats: SnapshotMetric,
  metric: { minPercentChange?: number },
  metricDefaults: MetricDefaults,
  differenceType: DifferenceType,
): boolean {
  if (!baseline?.cr || !stats?.cr || !stats?.expected) return false;

  const minPercentChange =
    metric.minPercentChange ?? metricDefaults.minPercentageChange ?? 0;

  if (differenceType === "relative") {
    return Math.abs(stats.expected) < minPercentChange;
  } else if (differenceType === "absolute") {
    return Math.abs(stats.expected) / Math.abs(baseline.cr) < minPercentChange;
  } else {
    // This means scaled impact could show up as too small even it is
    // large enough for other difference types if CUPED is applied
    // and CUPED causes the value to cross the threshold
    return (
      Math.abs(stats.cr - baseline.cr) / Math.abs(baseline.cr) <
      minPercentChange
    );
  }
}

export function getMetricResultStatus({
  metric,
  metricDefaults,
  baseline,
  stats,
  ciLower,
  ciUpper,
  pValueThreshold,
  statsEngine,
  differenceType,
}: {
  metric: ExperimentMetricDefinition;
  metricDefaults: MetricDefaults;
  baseline: SnapshotMetric;
  stats: SnapshotMetric;
  ciLower: number;
  ciUpper: number;
  pValueThreshold: number;
  statsEngine: StatsEngine;
  differenceType: DifferenceType;
}) {
  const directionalStatus: "winning" | "losing" =
    (stats.expected ?? 0) * (metric.inverse ? -1 : 1) > 0
      ? "winning"
      : "losing";

  const enoughData = hasEnoughData(baseline, stats, metric, metricDefaults);
  const belowMinChange = isBelowMinChange(
    baseline,
    stats,
    metric,
    metricDefaults,
    differenceType,
  );
  const _shouldHighlight = shouldHighlight({
    metric,
    baseline,
    stats,
    hasEnoughData: enoughData,
    belowMinChange,
  });

  let significant: boolean;
  let significantUnadjusted: boolean;
  if (statsEngine === "bayesian") {
    if (
      (stats.chanceToWin ?? 0) > ciUpper ||
      (stats.chanceToWin ?? 0) < ciLower
    ) {
      significant = true;
      significantUnadjusted = true;
    } else {
      significant = false;
      significantUnadjusted = false;
    }
  } else {
    significant = isStatSig(
      stats.pValueAdjusted ?? stats.pValue ?? 1,
      pValueThreshold,
    );
    significantUnadjusted = isStatSig(stats.pValue ?? 1, pValueThreshold);
  }

  let resultsStatus: "won" | "lost" | "draw" | "" = "";
  if (statsEngine === "bayesian") {
    if (_shouldHighlight && (stats.chanceToWin ?? 0.5) > ciUpper) {
      resultsStatus = "won";
    } else if (_shouldHighlight && (stats.chanceToWin ?? 0.5) < ciLower) {
      resultsStatus = "lost";
    }
    if (
      enoughData &&
      belowMinChange &&
      ((stats.chanceToWin ?? 0.5) > ciUpper ||
        (stats.chanceToWin ?? 0.5) < ciLower)
    ) {
      resultsStatus = "draw";
    }
  } else {
    if (_shouldHighlight && significant && directionalStatus === "winning") {
      resultsStatus = "won";
    } else if (
      _shouldHighlight &&
      significant &&
      directionalStatus === "losing"
    ) {
      resultsStatus = "lost";
    } else if (enoughData && significant && belowMinChange) {
      resultsStatus = "draw";
    }
  }

  let clearSignalResultsStatus: "won" | "lost" | "" = "";
  // TODO make function of existing thresholds
  if (statsEngine === "bayesian") {
    if (
      _shouldHighlight &&
      (stats.chanceToWin ?? 0.5) > Math.max(0.999, ciUpper)
    ) {
      clearSignalResultsStatus = "won";
    } else if (
      _shouldHighlight &&
      (stats.chanceToWin ?? 0.5) < Math.min(0.001, ciLower)
    ) {
      clearSignalResultsStatus = "lost";
    }
  } else {
    const clearStatSig = isStatSig(
      stats.pValueAdjusted ?? stats.pValue ?? 1,
      Math.min(pValueThreshold, 0.001),
    );
    if (_shouldHighlight && clearStatSig && directionalStatus === "winning") {
      clearSignalResultsStatus = "won";
    } else if (
      _shouldHighlight &&
      clearStatSig &&
      directionalStatus === "losing"
    ) {
      clearSignalResultsStatus = "lost";
    }
  }
  let guardrailSafeStatus = false;
  if (stats.ci) {
    const ciLowerGuardrail = stats.ci?.[0] ?? Number.NEGATIVE_INFINITY;
    const ciUpperGuardrail = stats.ci?.[1] ?? Number.POSITIVE_INFINITY;
    const guardrailChanceToWin =
      stats.chanceToWin ??
      chanceToWinFlatPrior(
        stats.expected ?? 0,
        ciLowerGuardrail,
        ciUpperGuardrail,
        pValueThreshold,
        metric.inverse,
      );
    guardrailSafeStatus = guardrailChanceToWin > 1 - DEFAULT_GUARDRAIL_ALPHA;
  }
  return {
    shouldHighlight: _shouldHighlight,
    belowMinChange,
    significant,
    significantUnadjusted,
    directionalStatus,
    resultsStatus,
    clearSignalResultsStatus,
    guardrailSafeStatus,
  };
}

export function chanceToWinFlatPrior(
  expected: number,
  lower: number,
  upper: number,
  pValueThreshold: number,
  inverse: boolean = false,
): number {
  if (
    lower === Number.NEGATIVE_INFINITY &&
    upper === Number.POSITIVE_INFINITY
  ) {
    return 0;
  }
  const confidenceIntervalType =
    lower === Number.NEGATIVE_INFINITY
      ? "oneSidedLesser"
      : upper === Number.POSITIVE_INFINITY
        ? "oneSidedGreater"
        : "twoSided";
  const halfwidth =
    confidenceIntervalType === "twoSided"
      ? 0.5 * (upper - lower)
      : confidenceIntervalType === "oneSidedGreater"
        ? expected - lower
        : upper - expected;
  const numTails = confidenceIntervalType === "twoSided" ? 2 : 1;
  const zScore = normal.quantile(1 - pValueThreshold / numTails, 0, 1);
  const s = halfwidth / zScore;
  if (s === 0) {
    if (expected === 0) {
      return 0;
    }
    const chanceToWin = expected > 0;
    return inverse ? 1 - +chanceToWin : +chanceToWin;
  }
  const ctwInverse = normal.cdf(-expected / s, 0, 1);
  if (inverse) {
    return ctwInverse;
  }
  return 1 - ctwInverse;
}

// get all metric ids from an experiment, excluding derived metrics (slices and
// funnel steps)
export function getAllMetricIdsFromExperiment(
  exp: {
    goalMetrics?: string[];
    secondaryMetrics?: string[];
    guardrailMetrics?: string[];
    activationMetric?: string | null;
  },
  includeActivationMetric: boolean,
  metricGroups: MetricGroupInterface[],
) {
  return Array.from(
    new Set(
      expandMetricGroups(
        [
          ...(exp.goalMetrics || []),
          ...(exp.secondaryMetrics || []),
          ...(exp.guardrailMetrics || []),
          ...(includeActivationMetric && exp.activationMetric
            ? [exp.activationMetric]
            : []),
        ],
        metricGroups,
      ),
    ),
  );
}

// Extracts all metric ids from an experiment, including derived metrics (slices
// and funnel steps)
// NOTE: The expandedMetricMap should be expanded via expandDerivedMetricsInMap()
// before calling this function
export function getAllExpandedMetricIdsFromExperiment({
  exp,
  expandedMetricMap,
  includeActivationMetric = true,
  metricGroups = [],
}: {
  exp: {
    goalMetrics?: string[];
    secondaryMetrics?: string[];
    guardrailMetrics?: string[];
    activationMetric?: string | null;
  };
  expandedMetricMap: Map<string, ExperimentMetricDefinition>;
  includeActivationMetric?: boolean;
  metricGroups?: MetricGroupInterface[];
}): string[] {
  const baseMetricIds = getAllMetricIdsFromExperiment(
    exp,
    includeActivationMetric,
    metricGroups,
  );
  const expandedMetricIds = new Set<string>(baseMetricIds);

  // Scoop up expanded metric ids that only exist in the map, not in the base
  // experiment: slice metrics (dim:, standard and custom) and funnel step
  // metrics (step=). The map is often expanded from a wider set of metrics than
  // `exp` (e.g. before unjoinable metrics were scrubbed), so only take derived
  // metrics whose parent is actually being analyzed.
  expandedMetricMap.forEach((_, metricId) => {
    const step = parseFunnelStepMetricId(metricId);
    if (!step.isFunnelStepMetric && !/[?&]dim:/.test(metricId)) return;
    const parentId = step.isFunnelStepMetric
      ? step.baseMetricId
      : parseSliceMetricId(metricId).baseMetricId;
    if (expandedMetricIds.has(parentId)) {
      expandedMetricIds.add(metricId);
    }
  });

  return Array.from(expandedMetricIds);
}

export interface SliceLevelsData {
  column: string;
  datatype: "string" | "boolean";
  levels: string[];
}

// For building slice metric rows (FE)
export interface SliceDataForMetric {
  id: string; // Format: `${parentId}?dim:${encodedColumnId}=${encodedValue}` or `${parentId}?dim:${encodedColumnId}=` for "other"
  name: string; // Format: `${parentName} (${columnName}: ${value})` or `${parentName} (${columnName}: other)`
  description: string;
  sliceLevels: SliceLevelsData[];
  allSliceLevels: string[];
}

// Creates auto slice data for a fact metric based on the metric's metricAutoSlices
// Used for FE: row generation, slice filtering/expansion
export function createAutoSliceDataForMetric({
  parentMetric,
  factTable,
  includeOther = true,
}: {
  parentMetric: ExperimentMetricDefinition | null | undefined;
  factTable: FactTableDefinition | null | undefined;
  includeOther?: boolean;
}): SliceDataForMetric[] {
  // Sanity checks
  if (!parentMetric || !isFactMetric(parentMetric)) return [];
  if (!factTable) return [];

  // Cast to FactMetricInterface after type check
  const factMetric = parentMetric as FactMetricInterface;
  if (!factMetric.metricAutoSlices?.length) return [];

  const sliceData: SliceDataForMetric[] = [];

  // Get the intersection of metricAutoSlices with fact table auto slice columns
  const factTableAutoSliceColumns = factTable.columns.filter(
    (col) =>
      col.isAutoSliceColumn &&
      !col.deleted &&
      (col.autoSlices?.length || 0) > 0,
  );

  const autoSliceColumns = factTableAutoSliceColumns.filter((col) =>
    factMetric.metricAutoSlices?.includes(col.column),
  );

  autoSliceColumns.forEach((col) => {
    const autoSlices = col.autoSlices || [];
    const columnName = col.name || col.column;

    // For boolean columns, generate true/false slices, "null" will be handled as "other" below
    const sliceValues =
      col.datatype === "boolean" ? ["true", "false"] : autoSlices;

    // Create slice data for each slice value
    sliceValues.forEach((value) => {
      const sliceString = generateSliceString({ [col.column]: value });
      sliceData.push({
        id: `${factMetric.id}?${sliceString}`,
        name: `${factMetric.name} (${columnName}: ${value})`,
        description: `Slice analysis of ${factMetric.name} for ${columnName} = ${value}`,
        sliceLevels: [
          {
            column: col.column,
            datatype: col.datatype as "string" | "boolean",
            levels: [value],
          },
        ],
        allSliceLevels: autoSlices,
      });
    });

    // Create an "other" slice data for values not in autoSlices (includes NULL for boolean)
    if (includeOther && (autoSlices.length > 0 || col.datatype === "boolean")) {
      const sliceString = generateSliceString({ [col.column]: "" });
      sliceData.push({
        id: `${factMetric.id}?${sliceString}`,
        name: `${factMetric.name} (${columnName}: other)`,
        description: `Slice analysis of ${factMetric.name} for ${columnName} (other)`,
        sliceLevels: [
          {
            column: col.column,
            datatype: col.datatype as "string" | "boolean",
            levels: [],
          },
        ],
        allSliceLevels: autoSlices,
      });
    }
  });

  return sliceData;
}

// Auto-slice metric variants of a base fact metric (clones with slice-encoded
// ids `<baseId>?dim:col=value`, plus an "other" bucket). Experiment-independent
// so it can be reused outside `expandDerivedMetricsInMap`.
export function getAutoSliceMetrics({
  metric,
  factTable,
}: {
  metric: FactMetricInterface;
  factTable: FactTableDefinition;
}): FactMetricInterface[] {
  if (!metric.metricAutoSlices?.length) return [];

  const autoSliceColumns = factTable.columns.filter(
    (col) =>
      col.isAutoSliceColumn &&
      !col.deleted &&
      (col.autoSlices?.length || 0) > 0 &&
      metric.metricAutoSlices?.includes(col.column),
  );

  const sliceMetrics: FactMetricInterface[] = [];

  autoSliceColumns.forEach((col) => {
    const autoSlices = col.autoSlices || [];

    // One metric per configured auto slice value.
    autoSlices.forEach((value: string) => {
      const sliceString = generateSliceString({ [col.column]: value });
      sliceMetrics.push({
        ...metric,
        id: `${metric.id}?${sliceString}`,
        name: `${metric.name} (${col.name || col.column}: ${value})`,
        description: `Slice analysis of ${metric.name} for ${col.name || col.column} = ${value}`,
      });
    });

    // An "other" bucket for values not in autoSlices (includes NULL for boolean).
    if (autoSlices.length > 0 || col.datatype === "boolean") {
      const sliceString = generateSliceString({ [col.column]: "" });
      sliceMetrics.push({
        ...metric,
        id: `${metric.id}?${sliceString}`,
        name: `${metric.name} (${col.name || col.column}: other)`,
        description: `Slice analysis of ${metric.name} for ${col.name || col.column} = other`,
      });
    }
  });

  return sliceMetrics;
}

// Creates custom slice data for a fact metric by using the experiment's customMetricSlices
export function createCustomSliceDataForMetric({
  metricId,
  metricName,
  customMetricSlices,
  factTable,
}: {
  metricId: string;
  metricName: string;
  customMetricSlices?: { slices: { column: string; levels: string[] }[] }[];
  factTable?: FactTableDefinition | null;
}): SliceDataForMetric[] {
  // Sanity checks
  if (!customMetricSlices?.length) return [];

  const customSliceData: SliceDataForMetric[] = [];

  customMetricSlices.forEach((group) => {
    // Sort slices alphabetically for consistent ID generation
    const sortedSlices = group.slices.sort((a, b) =>
      a.column.localeCompare(b.column),
    );

    // Create slice levels with proper handling for boolean "null" values
    const sliceLevelsForString = sortedSlices.map((d) => {
      const column = factTable?.columns.find((col) => col.column === d.column);
      // For boolean "null" slices, use empty array to generate ?dim:col= format
      const levels =
        d.levels[0] === "null" && column?.datatype === "boolean"
          ? []
          : d.levels;
      return {
        column: d.column,
        datatype: (column?.datatype === "boolean" ? "boolean" : "string") as
          | "string"
          | "boolean",
        levels,
      };
    });

    const sliceString = generateSliceStringFromLevels(sliceLevelsForString);

    const customSliceMetric = {
      id: `${metricId}?${sliceString}`,
      name: `${metricName} (${sortedSlices.map((combo) => `${combo.column}: ${combo.levels[0] || ""}`).join(", ")})`,
      description: `Slice analysis of ${metricName} for ${sortedSlices.map((combo) => `${combo.column} = ${combo.levels[0] || ""}`).join(" and ")}`,
      sliceLevels: sortedSlices.map((d) => {
        const column = factTable?.columns.find(
          (col) => col.column === d.column,
        );
        // For boolean "null" slices, use empty array to match "other" slice format
        const levels =
          d.levels[0] === "null" && column?.datatype === "boolean"
            ? []
            : d.levels;
        return {
          column: d.column,
          datatype: (column?.datatype === "boolean" ? "boolean" : "string") as
            | "string"
            | "boolean",
          levels,
        };
      }),
      allSliceLevels: sortedSlices.flatMap((slice) => slice.levels),
    };
    customSliceData.push(customSliceMetric);
  });

  return customSliceData;
}

export function generateSelectAllSliceString(column: string): string {
  // Generate "select all" tag format: dim:column (no equals sign)
  return `dim:${encodeURIComponent(column)}`;
}

export function generateSliceString(slices: Record<string, string>): string {
  const sortedSlices = Object.entries(slices).sort((a, b) =>
    a[0].localeCompare(b[0]),
  );
  return sortedSlices
    .map(
      ([col, val]) =>
        `dim:${encodeURIComponent(col)}=${encodeURIComponent(val)}`,
    )
    .join("&");
}

export function generateSliceStringFromLevels(
  sliceLevels: SliceLevelsData[],
): string {
  const slices: Record<string, string> = {};
  sliceLevels.forEach((dl) => {
    slices[dl.column] = dl.levels[0] || "";
  });
  return generateSliceString(slices);
}

/**
 * Allowed drift when checking that variation weights sum to 1.
 * Matches sdk-js and NewPhaseForm (0.99 … 1.01 inclusive).
 */
const VARIATION_WEIGHTS_SUM_TOLERANCE = 0.01;

/**
 * Returns whether variation weights are valid: their sum is ~1 within tolerance
 * (avoids strict float equality).
 */
export function isVariationWeightsSumValid(
  weights: number[],
  tolerance: number = VARIATION_WEIGHTS_SUM_TOLERANCE,
): boolean {
  const sum = weights.reduce((acc, w) => acc + w, 0);
  return Math.abs(sum - 1) <= tolerance;
}

// Returns n "equal" decimals rounded to 3 places that add up to 1
// The sum always adds to 1. In some cases the values are not equal.
// For example, getEqualWeights(3) returns [0.3334, 0.3333, 0.3333]
export function getEqualWeights(n: number, precision: number = 4): number[] {
  // The power of 10 we need to manipulate weights to the correct precision
  const multiplier = Math.pow(10, precision);

  // Naive even weighting with rounding
  // For n=3, this will result in `0.3333`
  const w = Math.round(multiplier / n) / multiplier;

  // Determine how far off we are from a sum of 1
  // For n=3, this will be 0.9999-1 = -0.0001
  const diff = w * n - 1;

  // How many of the weights do we need to add a correction to?
  // For n=3, we only have to adjust 1 of the weights to make it sum to 1
  const numCorrections = Math.round(Math.abs(diff) * multiplier);
  const delta = (diff < 0 ? 1 : -1) / multiplier;

  return (
    Array(n)
      .fill(0)
      .map((v, i) => +(w + (i < numCorrections ? delta : 0)).toFixed(precision))
      // Put the larger weights first
      .sort((a, b) => b - a)
  );
}

export async function generateTrackingKey<
  T = ExperimentInterface | ExperimentInterfaceStringDates,
>(
  exp: Partial<ExperimentInterface>,
  getEntityByKey?: (key: string) => Promise<T | null>,
): Promise<string> {
  // Try to generate a unique tracking key based on the experiment name
  let n = 1;
  let found: null | string = null;
  while (n < 10 && !found) {
    const key = generate(exp.name || exp.id || "", n);
    if (!getEntityByKey || !(await getEntityByKey(key))) {
      found = key;
    }
    n++;
  }

  // Fall back to uniqid if couldn't generate
  return found || uniqid();

  function generate(name: string, n: number): string {
    let key = ("-" + name)
      .toLowerCase()
      // Replace whitespace with hyphen
      .replace(/\s+/g, "-")
      // Get rid of all non alpha-numeric characters
      .replace(/[^a-z0-9\-_]*/g, "")
      // Remove stopwords
      .replace(
        /-((a|about|above|after|again|all|am|an|and|any|are|arent|as|at|be|because|been|before|below|between|both|but|by|cant|could|did|do|does|dont|down|during|each|few|for|from|had|has|have|having|here|how|if|in|into|is|isnt|it|its|itself|more|most|no|nor|not|of|on|once|only|or|other|our|out|over|own|same|should|shouldnt|so|some|such|that|than|then|the|there|theres|these|this|those|through|to|too|under|until|up|very|was|wasnt|we|weve|were|what|whats|when|where|which|while|who|whos|whom|why|with|wont|would)-)+/g,
        "-",
      )
      // Collapse duplicate hyphens
      .replace(/-{2,}/g, "-")
      // Remove leading and trailing hyphens
      .replace(/(^-|-$)/g, "");

    // Add number if this is not the first attempt
    if (n > 1) {
      key += "-" + n;
    }

    return key;
  }
}

export function expandMetricGroups(
  metricIds: string[],
  metricGroups: MetricGroupInterface[],
): string[] {
  const metricGroupMap = new Map(metricGroups.map((mg) => [mg.id, mg]));
  const expandedMetricIds: string[] = [];
  metricIds.forEach((id) => {
    if (metricGroupMap.has(id)) {
      expandedMetricIds.push(...(metricGroupMap.get(id)?.metrics || []));
    } else {
      expandedMetricIds.push(id);
    }
  });
  return expandedMetricIds;
}

export function resolveMetricTiers(
  guardrailIds: string[],
  signalIds: string[],
  metricGroups: MetricGroupInterface[],
): { guardrail: Set<string>; signal: Set<string> } {
  const expandedGuardrail = new Set(
    expandMetricGroups(guardrailIds, metricGroups),
  );
  const expandedSignal = new Set(expandMetricGroups(signalIds, metricGroups));

  for (const id of expandedSignal) {
    if (expandedGuardrail.has(id)) {
      expandedSignal.delete(id);
    }
  }

  return { guardrail: expandedGuardrail, signal: expandedSignal };
}

export function isMetricJoinable(
  metricIdTypes: string[],
  userIdType: string,
  settings?: DataSourceSettings,
): boolean {
  if (metricIdTypes.includes(userIdType)) return true;

  if (settings?.queries?.identityJoins) {
    if (
      settings.queries.identityJoins.some(
        (j) =>
          j.ids.includes(userIdType) &&
          j.ids.some((jid) => metricIdTypes.includes(jid)),
      )
    ) {
      return true;
    }
  }

  // legacy support for pageviewsQuery
  if (settings?.queries?.pageviewsQuery) {
    if (
      ["user_id", "anonymous_id"].includes(userIdType) &&
      metricIdTypes.some((m) => ["user_id", "anonymous_id"].includes(m))
    ) {
      return true;
    }
  }

  return false;
}

export function adjustPValuesBenjaminiHochberg(
  indexedPValues: IndexedPValue[],
): IndexedPValue[] {
  const newIndexedPValues = cloneDeep<IndexedPValue[]>(indexedPValues);
  const m = newIndexedPValues.length;

  newIndexedPValues.sort((a, b) => {
    return b.pValue - a.pValue;
  });
  newIndexedPValues.forEach((p, i) => {
    newIndexedPValues[i].pValue = Math.min((p.pValue * m) / (m - i), 1);
  });

  let tempval = newIndexedPValues[0].pValue;
  for (let i = 1; i < m; i++) {
    if (newIndexedPValues[i].pValue < tempval) {
      tempval = newIndexedPValues[i].pValue;
    } else {
      newIndexedPValues[i].pValue = tempval;
    }
  }
  return newIndexedPValues;
}

export function adjustPValuesHolmBonferroni(
  indexedPValues: IndexedPValue[],
): IndexedPValue[] {
  const newIndexedPValues = cloneDeep<IndexedPValue[]>(indexedPValues);
  const m = newIndexedPValues.length;
  newIndexedPValues.sort((a, b) => {
    return a.pValue - b.pValue;
  });
  newIndexedPValues.forEach((p, i) => {
    newIndexedPValues[i].pValue = Math.min(p.pValue * (m - i), 1);
  });

  let tempval = newIndexedPValues[0].pValue;
  for (let i = 1; i < m; i++) {
    if (newIndexedPValues[i].pValue > tempval) {
      tempval = newIndexedPValues[i].pValue;
    } else {
      newIndexedPValues[i].pValue = tempval;
    }
  }
  return newIndexedPValues;
}

export function setAdjustedPValuesOnResults(
  results: ExperimentReportResultDimension[],
  nonGuardrailMetrics: string[],
  adjustment: PValueCorrection,
): void {
  if (!adjustment) {
    return;
  }

  let indexedPValues: IndexedPValue[] = [];
  results.forEach((r, i) => {
    r.variations.forEach((v, j) => {
      nonGuardrailMetrics.forEach((m) => {
        const pValue = v.metrics[m]?.pValue;
        if (pValue !== undefined) {
          indexedPValues.push({
            pValue: pValue,
            index: [i, j, m],
          });
        }
      });
    });
  });

  if (indexedPValues.length === 0) {
    return;
  }

  if (adjustment === "benjamini-hochberg") {
    indexedPValues = adjustPValuesBenjaminiHochberg(indexedPValues);
  } else if (adjustment === "holm-bonferroni") {
    indexedPValues = adjustPValuesHolmBonferroni(indexedPValues);
  }

  // modify results in place
  indexedPValues.forEach((ip) => {
    const ijk = ip.index;
    results[ijk[0]].variations[ijk[1]].metrics[ijk[2]].pValueAdjusted =
      ip.pValue;
  });
  return;
}

export function adjustedCI(
  adjustedPValue: number,
  lift: number | undefined,
  pValueThreshold: number,
): [number, number] {
  if (!lift) return [0, 0];
  const zScore = normal.quantile(1 - pValueThreshold / 2, 0, 1);
  const adjStdDev = Math.abs(
    lift / normal.quantile(1 - adjustedPValue / 2, 0, 1),
  );
  const width = zScore * adjStdDev;
  return [lift - width, lift + width];
}

export function setAdjustedCIs(
  results: ExperimentReportResultDimension[],
  pValueThreshold: number,
): void {
  results.forEach((r) => {
    r.variations.forEach((v) => {
      for (const key in v.metrics) {
        const pValueAdjusted = v.metrics[key].pValueAdjusted;
        const uplift = v.metrics[key].uplift;
        const ci = v.metrics[key].ci;
        if (
          pValueAdjusted === undefined ||
          uplift === undefined ||
          ci === undefined
        ) {
          continue;
        }

        const adjCI = getAdjustedCI(
          pValueAdjusted,
          uplift.mean,
          pValueThreshold,
          ci,
        );
        if (adjCI) {
          v.metrics[key].ciAdjusted = adjCI;
        } else {
          v.metrics[key].ciAdjusted = ci;
        }
      }
    });
  });
  return;
}

export function getAdjustedCI(
  pValueAdjusted: number,
  lift: number | undefined,
  pValueThreshold: number,
  ci: [number, number],
): [number, number] | undefined {
  // set to Inf if adjusted pValue is 1
  if (pValueAdjusted > 0.999999) {
    return [-Infinity, Infinity];
  }

  const adjCI = adjustedCI(pValueAdjusted, lift, pValueThreshold);
  // only update if CI got wider, should never get more narrow
  if (adjCI[0] < ci[0] && adjCI[1] > ci[1]) {
    return adjCI;
  } else {
    return ci;
  }
}

export function dedupeSliceMetrics(
  metrics: SliceDataForMetric[],
): SliceDataForMetric[] {
  const seen = new Set<string>();
  return metrics.filter((metric) => {
    if (seen.has(metric.id)) {
      return false;
    }
    seen.add(metric.id);
    return true;
  });
}

/**
 * Adds every metric derived from the experiment's stored metrics to the map:
 * slice metrics (auto and custom) and funnel step metrics. These only ever
 * exist in the map, so analysis, naming, and result lookups by id all depend on
 * this having run.
 */
export function expandDerivedMetricsInMap({
  metricMap,
  factTableMap,
  experiment,
  metricGroups = [],
}: {
  metricMap: Map<string, ExperimentMetricDefinition>;
  factTableMap: FactTableDefinitionMap;
  experiment: Pick<
    ExperimentInterface,
    | "goalMetrics"
    | "secondaryMetrics"
    | "guardrailMetrics"
    | "activationMetric"
    | "customMetricSlices"
  >;
  metricGroups?: MetricGroupInterface[];
}): void {
  // Get base metrics
  const baseMetricIds = getAllMetricIdsFromExperiment(
    experiment,
    false,
    metricGroups,
  );
  const baseMetrics = baseMetricIds.map((m) => metricMap.get(m)!);

  for (const metric of baseMetrics) {
    if (!metric) continue;
    if (!isFactMetric(metric)) continue;
    // A funnel expands into its per-step proportions instead of slices, which
    // are not supported for funnel metrics yet.
    if (isFactFunnelMetric(metric)) {
      getFunnelStepMetrics(metric).forEach((stepMetric) => {
        metricMap.set(stepMetric.id, stepMetric);
      });
      continue;
    }

    const factTable = factTableMap.get(metric.numerator.factTableId);
    if (!factTable) continue;

    // 1. Add auto slice metrics
    getAutoSliceMetrics({ metric, factTable }).forEach((sliceMetric) => {
      metricMap.set(sliceMetric.id, sliceMetric);
    });

    // 2. Add custom slice metrics
    if (experiment.customMetricSlices) {
      experiment.customMetricSlices.forEach((customSliceGroup) => {
        // Sort slices alphabetically for consistent ID generation
        const sortedSliceGroups = customSliceGroup.slices.sort((a, b) =>
          a.column.localeCompare(b.column),
        );

        // Verify all custom slice columns exist and are string or boolean type
        const hasAllRequiredColumns = sortedSliceGroups.every((slice) => {
          const column = factTable.columns.find(
            (col) => col.column === slice.column,
          );
          return (
            column &&
            !column.deleted &&
            (column.datatype === "string" || column.datatype === "boolean") &&
            !factTable.userIdTypes.includes(column.column)
          );
        });

        if (!hasAllRequiredColumns) return;

        // Create slice levels
        const sliceLevelsForString = sortedSliceGroups.map((d) => {
          const column = factTable.columns.find(
            (col) => col.column === d.column,
          );
          // For boolean "null" slices, use empty array to generate ?dim:col= format
          const levels =
            column?.datatype === "boolean" && d.levels[0] === "null"
              ? []
              : d.levels;
          return {
            column: d.column,
            datatype: (column?.datatype === "boolean"
              ? "boolean"
              : "string") as "string" | "boolean",
            levels,
          };
        });

        const sliceString = generateSliceStringFromLevels(sliceLevelsForString);

        const customSliceMetric: ExperimentMetricDefinition = {
          ...metric,
          id: `${metric.id}?${sliceString}`,
          name: `${metric.name} (${sortedSliceGroups.map((combo) => `${combo.column}: ${combo.levels[0] || ""}`).join(", ")})`,
          description: `Slice analysis of ${metric.name} for ${sortedSliceGroups.map((combo) => `${combo.column} = ${combo.levels[0] || ""}`).join(" and ")}`,
        };
        metricMap.set(customSliceMetric.id, customSliceMetric);
      });
    }
  }
}

/**
 * True when the dimension is either precomputed, or a unit dimension explicitly listed in `snapshotUnitDimensionIds`.
 * snapshotUnitDimensionIds is derived from experiment.precomputedUnitDimensionIds, and in this case it should be
 * treated the same, as it is precomputed.
 */
export function isDimensionPrecomputed(
  dimension: string | undefined,
  snapshotUnitDimensionIds: string[],
): boolean {
  if (dimension?.startsWith(PRECOMPUTED_DIMENSION_PREFIX)) {
    return true;
  }

  return !!dimension && snapshotUnitDimensionIds.includes(dimension);
}

/**
 * Returns the LookbackOverride only when both conditions are met:
 *   1. attributionModel === "lookbackOverride"
 *   2. lookbackOverride is defined
 * Use this everywhere you need to decide whether to apply a lookback override.
 */
export function getEffectiveLookbackOverride(
  attributionModel: AttributionModel | undefined,
  lookbackOverride: LookbackOverride | undefined,
): LookbackOverride | undefined {
  if (attributionModel === "lookbackOverride" && lookbackOverride) {
    return lookbackOverride;
  }
  return undefined;
}
