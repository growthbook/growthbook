import { format as sqlFormat } from "sql-formatter";
import { SqlResultChunkInterface } from "../types/query";
import {
  FormatDialect,
  GlobMatchFn,
  SqlDialect,
  SqlIdentifierQuote,
  SqlStringRules,
  StringMatchFn,
} from "../types/sql";
import { FormatError } from "../types/error";
import { parseEnvInt } from "./util/numbers";

/** Escaping and LIKE-clause behavior for one dialect. Shared by the string-match
 *  and glob-match builders so a dialect configures both from one place. */
type LikeMatchOptions = {
  escapeStringLiteral: (s: string) => string;
  escapeWildcards?: (s: string) => string;
  emitEscapeClause: boolean;
};

const defaultEscapeWildcards = (value: string) =>
  value.replace(/([%_\\])/g, "\\$1");

/**
 * Creates a function that builds a string-match condition (LIKE or a warehouse-native equivalent).
 *
 * This is needed because in some dialects, _ and \ are treated as wildcard characters for LIKE,
 * and we want to escape them correctly to we can match them literally.
 */
export function createLikeStringMatchFn({
  escapeStringLiteral,
  escapeWildcards = defaultEscapeWildcards,
  emitEscapeClause,
}: LikeMatchOptions): StringMatchFn {
  return (columnExpr, operator, value) => {
    const isPattern =
      operator === "matches_pattern" || operator === "not_matches_pattern";
    const pattern = escapeStringLiteral(
      isPattern
        ? globToLikePattern(value, escapeWildcards)
        : escapeWildcards(value),
    );
    const escapeClause = emitEscapeClause
      ? ` ESCAPE '${escapeStringLiteral("\\")}'`
      : "";
    switch (operator) {
      case "matches_pattern":
        return `${columnExpr} LIKE '${pattern}'${escapeClause}`;
      case "not_matches_pattern":
        return `${columnExpr} NOT LIKE '${pattern}'${escapeClause}`;
      case "starts_with":
        return `${columnExpr} LIKE '${pattern}%'${escapeClause}`;
      case "ends_with":
        return `${columnExpr} LIKE '%${pattern}'${escapeClause}`;
      case "contains":
        return `${columnExpr} LIKE '%${pattern}%'${escapeClause}`;
      case "not_contains":
        return `${columnExpr} NOT LIKE '%${pattern}%'${escapeClause}`;
    }
  };
}

/**
 * Translates a user-facing wildcard pattern into a LIKE pattern. `*` matches any
 * run of characters and `?` matches exactly one; everything else is literal.
 *
 * LIKE's own metacharacters are escaped in the literal chunks *before* the
 * wildcards are substituted, so a pattern like `/reports/50%_*` matches a
 * literal "50%_" followed by anything, rather than treating the `%` and `_` as
 * wildcards of their own.
 */
export function globToLikePattern(
  glob: string,
  escapeWildcards: (s: string) => string = defaultEscapeWildcards,
): string {
  return glob
    .split(/([*?])/)
    .map((chunk) => {
      if (chunk === "*") return "%";
      if (chunk === "?") return "_";
      return escapeWildcards(chunk);
    })
    .join("");
}

/**
 * Creates a function that matches a column against a user-facing wildcard
 * pattern (`*` any run, `?` one character).
 */
export function createGlobMatchFn({
  escapeStringLiteral,
  escapeWildcards = defaultEscapeWildcards,
  emitEscapeClause,
}: LikeMatchOptions): GlobMatchFn {
  return (columnExpr, glob) => {
    const pattern = escapeStringLiteral(
      globToLikePattern(glob, escapeWildcards),
    );
    const escapeClause = emitEscapeClause
      ? ` ESCAPE '${escapeStringLiteral("\\")}'`
      : "";
    return `${columnExpr} LIKE '${pattern}'${escapeClause}`;
  };
}

/** Both LIKE matchers from one options object so escaping cannot drift. */
export function createLikeMatchFns(options: LikeMatchOptions): {
  stringMatch: StringMatchFn;
  globMatch: GlobMatchFn;
} {
  return {
    stringMatch: createLikeStringMatchFn(options),
    globMatch: createGlobMatchFn(options),
  };
}

// Wraps a SQL identifier (column, alias) in the dialect's quote character,
// escaping any embedded quotes by doubling them (ANSI SQL convention).
export function quoteIdentifier(name: string, q: SqlIdentifierQuote): string {
  return `${q}${name.replace(new RegExp(q, "g"), q + q)}${q}`;
}

// Quotes a column the user named in their own SQL. Quoting is exact-match, so
// the name must first be folded the way the warehouse folded their unquoted
// alias: Snowflake's `AS user_id` becomes USER_ID, which `"user_id"` misses.
export function quoteColumnIdentifier(
  name: string,
  dialect: Pick<SqlDialect, "identifierQuote" | "unquotedIdentifierFold">,
): string {
  const folded =
    dialect.unquotedIdentifierFold === "upper"
      ? name.toUpperCase()
      : dialect.unquotedIdentifierFold === "lower"
        ? name.toLowerCase()
        : name;
  return quoteIdentifier(folded, dialect.identifierQuote);
}

export const SQL_ROW_LIMIT = 1000;
export const ASK_ROW_LIMIT = 500;

export const MAX_SQL_LENGTH_TO_FORMAT = parseEnvInt(
  process.env.MAX_SQL_LENGTH_TO_FORMAT,
  15_000,
  { min: 1, name: "MAX_SQL_LENGTH_TO_FORMAT" },
);

export function format(
  sql: string,
  dialect?: FormatDialect,
  onError?: (error: FormatError) => void,
): string {
  // sqlFormat is slow, consuming a lot of CPU and blocking other operations.
  // To avoid performance issues, skip formatting for very large queries.
  if (MAX_SQL_LENGTH_TO_FORMAT && sql.length > MAX_SQL_LENGTH_TO_FORMAT) {
    return sql;
  }
  if (!dialect) return sql;

  try {
    return sqlFormat(sql, {
      language: dialect,
    });
  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e));
    if (onError) {
      onError({ error, originalSql: sql });
    }
    return sql;
  }
}

/**
 * Drop a terminating semicolon even when a trailing comment follows it, e.g.
 * `SELECT 1;\n-- note`. `/;\s*$/` misses that case and the leftover `;` then
 * fails multi-statement checks after the query is wrapped in a subquery.
 *
 * Implemented as a single linear scan rather than a regex: the equivalent
 * `/;(\s|--[^\n]*|\/\*[\s\S]*?\*\/)*$/` backtracks exponentially on input
 * like `";" + "/**\/".repeat(n) + "x"`, and this runs on user-supplied SQL.
 *
 * Everything from the last `;` that is followed only by whitespace, `--` line
 * comments and terminated block comments is removed. Quoted text is read
 * with the dialect's `rules` (see `getSqlStringRules`), so a `;` or `--`
 * inside a string or quoted identifier is left alone. If a quote is never
 * closed, quotes are ignored instead.
 */
export function stripTrailingSemicolon(
  sql: string,
  rules: SqlStringRules,
): string {
  const cut = trailingSemicolonIndex(sql, rules);
  if (cut < sql.length) return sql.slice(0, cut).trim();
  // No terminator found. A `;` that ends the SQL cannot be inside a string or
  // a block comment in any dialect, since both need a closing delimiter after
  // it, so it is safe to drop.
  const trimmed = sql.trimEnd();
  return (trimmed.endsWith(";") ? trimmed.slice(0, -1) : trimmed).trim();
}

// Index of the terminating `;`, or `sql.length` if there is none. With
// `rules` null, quotes are ignored.
function trailingSemicolonIndex(
  sql: string,
  rules: SqlStringRules | null,
): number {
  // Index of the most recent `;` that has only trivia after it so far.
  let cut = -1;
  // Once a `/*` has no closing `*/` anywhere after it, no later one can either.
  let noMoreBlockCommentEnds = false;
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    const quoteEnd = rules ? quotedSpanEnd(sql, i, rules) : null;
    if (ch === ";") {
      cut = i;
      i++;
    } else if (quoteEnd !== null) {
      // Quoted text is never trivia
      if (quoteEnd === -1) return trailingSemicolonIndex(sql, null);
      cut = -1;
      i = quoteEnd + 1;
    } else if (!rules && cut === -1) {
      // Not (yet) in a trailing run, so nothing here can be trivia.
      i++;
    } else if (/\s/.test(ch)) {
      i++;
    } else if (ch === "-" && sql[i + 1] === "-") {
      i += 2;
      while (i < sql.length && sql[i] !== "\n" && sql[i] !== "\r") i++;
    } else if (ch === "/" && sql[i + 1] === "*" && !noMoreBlockCommentEnds) {
      const end = sql.indexOf("*/", i + 2);
      if (end === -1) {
        // Unterminated comment: the run is broken, but a later `;` inside the
        // comment text can still start a new one.
        noMoreBlockCommentEnds = true;
        cut = -1;
        i++;
      } else {
        i = end + 2;
      }
    } else {
      cut = -1;
      i++;
    }
  }
  return cut === -1 ? sql.length : cut;
}

// Any template variable built on startDate, e.g. {{startDate}} or
// {{date startDateISO "yyyyMMdd"}}. Without one, every query scans the whole table.
export function hasStartDateFilter(sql: string): boolean {
  return /\{\{[^}]*startDate/.test(sql);
}

export function ensureLimit(
  sql: string,
  limit: number,
  rules: SqlStringRules,
): string {
  if (limit <= 0) throw new Error("Limit must be a positive integer");

  sql = stripTrailingSemicolon(sql, rules);

  // Case 1: Has both LIMIT and OFFSET clauses
  const limitOffsetMatch = sql.match(/LIMIT\s+(\d+)\s+OFFSET\s+(\d+)$/i);
  if (limitOffsetMatch) {
    const currentLimit = parseInt(limitOffsetMatch[1], 10);
    if (!isNaN(currentLimit) && currentLimit <= limit) {
      return sql;
    }
    return sql.replace(
      /LIMIT\s+\d+\s+OFFSET\s+(\d+)$/i,
      `LIMIT ${limit} OFFSET $1`,
    );
  }
  // Case 2: Has OFFSET clause only (BigQuery is the only one that supports this)
  if (/OFFSET\s+\d+$/i.test(sql)) {
    return sql.replace(/OFFSET\s+(\d+)$/i, `LIMIT ${limit} OFFSET $1`);
  }
  // Case 3: LIMIT clause only, but with 2 numbers (MySQL only)
  const limitTwoNumbersMatch = sql.match(/LIMIT\s+(\d+)\s*,\s*(\d+)$/i);
  if (limitTwoNumbersMatch) {
    const currentLimit = parseInt(limitTwoNumbersMatch[2], 10);
    if (!isNaN(currentLimit) && currentLimit <= limit) {
      return sql;
    }
    return sql.replace(/LIMIT\s+(\d+)\s*,\s*\d+$/i, `LIMIT $1, ${limit}`);
  }
  // Case 4: Normal LIMIT clause only
  const limitMatch = sql.match(/LIMIT\s+(\d+)$/i);
  if (limitMatch) {
    const currentLimit = parseInt(limitMatch[1], 10);
    if (!isNaN(currentLimit) && currentLimit <= limit) {
      return sql;
    }

    return sql.replace(/LIMIT\s+\d+$/i, `LIMIT ${limit}`);
  }
  // Default: Append LIMIT at the end
  // Add a newline in case there's a line comment at the end
  return `${sql}\nLIMIT ${limit}`;
}

// Only the first keyword is read, so the quoting rules barely matter here
const FIRST_KEYWORD_RULES: SqlStringRules = {
  backslashEscapes: true,
  bracketIdentifiers: false,
  eStrings: false,
};

export function isReadOnlySQL(sql: string) {
  const { strippedSql } = stripCommentsAndStrings(sql, FIRST_KEYWORD_RULES);

  // Check the first keyword (e.g. "select", "with", etc.)
  return !!strippedSql.match(/^\s*(with|select|explain|show|describe|desc)\b/i);
}

const MAX_AGENT_SQL_LENGTH = 100_000;

const DML_DDL_DENY_LIST =
  /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|MERGE|GRANT|REVOKE|CALL|EXEC|EXECUTE)\b/i;

// `$$` or `$tag$`, not preceded by an identifier character (`a$b$` is a name).
// Postgres counts every non-ASCII character as an identifier character.
const DOLLAR_QUOTE_OPENER =
  /(?<![\w$\u0080-\uffff])\$(?:[A-Za-z_\u0080-\uffff][\w\u0080-\uffff]*)?\$/;

const DIALECT_ESCAPE_HATCHES =
  /\b(INTO\s+OUTFILE|INTO\s+DUMPFILE|COPY\s+.{1,200}\s+TO|pg_read_file|pg_read_binary_file|LOAD_FILE|EXECUTE\s+IMMEDIATE)\b|(?<!\w)(file|url|s3)\s*\(/i;

/**
 * Stricter read-only SQL guard for agent-generated queries. Unlike
 * `isReadOnlySQL` (first-keyword only), this scans the entire stripped
 * statement for DML/DDL keywords, multi-statement boundaries, and
 * dialect-specific escape hatches. Throws on violation.
 *
 * `rules` must match the data source's dialect (see `getSqlStringRules`):
 * reading `'C:\'`, `E'\''` or `[it's]` with the wrong rules puts the end of a
 * string in the wrong place, which hides the SQL after it from the checks.
 */
export function assertSafeReadOnlySQL(
  sql: string,
  rules: SqlStringRules,
): void {
  if (sql.length > MAX_AGENT_SQL_LENGTH) {
    throw new Error(
      `Query exceeds the ${MAX_AGENT_SQL_LENGTH}-character safety limit`,
    );
  }

  const { strippedSql, parseError } = stripCommentsAndStrings(sql, rules);

  // Looking at the stripped SQL leaves a `$$` inside a string or comment
  // alone.
  if (DOLLAR_QUOTE_OPENER.test(strippedSql)) {
    throw new Error(
      "Dollar-quoted strings are not allowed. Use single-quoted strings instead.",
    );
  }

  if (parseError) {
    throw new Error(
      "Query has unterminated string or comment — cannot verify safety",
    );
  }

  // First keyword must be SELECT or WITH
  if (!/^\s*(SELECT|WITH)\b/i.test(strippedSql)) {
    throw new Error("Only SELECT and WITH queries are allowed");
  }

  // Single statement only
  if (strippedSql.includes(";")) {
    throw new Error("Multi-statement queries are not allowed");
  }

  // Dialect-specific escape hatches (checked before generic SELECT INTO)
  const escapeMatch = strippedSql.match(DIALECT_ESCAPE_HATCHES);
  if (escapeMatch) {
    throw new Error(`Disallowed expression: ${escapeMatch[0].trim()}`);
  }

  // DML/DDL deny-list anywhere in the stripped SQL. Checked before INTO so
  // INSERT INTO and MERGE INTO report the statement, not SELECT INTO.
  const dmlMatch = strippedSql.match(DML_DDL_DENY_LIST);
  if (dmlMatch) {
    throw new Error(`Disallowed keyword: ${dmlMatch[0].toUpperCase()}`);
  }

  // SELECT INTO (but not INTO OUTFILE/DUMPFILE — caught above). The query
  // starts with SELECT or WITH, strings are emptied and comments become a
  // space, so any INTO left is a write, on whichever line it appears.
  if (/\bINTO\b/i.test(strippedSql)) {
    throw new Error("SELECT INTO is not allowed");
  }
}

export function usesBackslashStringEscapes(
  dialect: Pick<SqlDialect, "escapeStringLiteral">,
): boolean {
  return dialect.escapeStringLiteral("\\") !== "\\";
}

export function getSqlStringRules(
  dialect: Pick<
    SqlDialect,
    "escapeStringLiteral" | "bracketIdentifiers" | "eStrings"
  >,
): SqlStringRules {
  return {
    backslashEscapes: usesBackslashStringEscapes(dialect),
    bracketIdentifiers: dialect.bracketIdentifiers,
    eStrings: dialect.eStrings,
  };
}

// Whether the `'` at `sql[i]` opens an `E'...'` string: the `e` before it must
// be a word of its own, not the end of a longer one (`date'2026-01-01'`).
function opensEString(sql: string, i: number): boolean {
  const prefix = sql[i - 1];
  if (prefix !== "e" && prefix !== "E") return false;
  const before = sql[i - 2];
  return before === undefined || !/[\w$\u0080-\uffff]/.test(before);
}

// If `sql[i]` opens a string or quoted identifier under `rules`, the index of
// the character that closes it, or -1 if it is never closed. Null otherwise.
function quotedSpanEnd(
  sql: string,
  i: number,
  rules: SqlStringRules,
): number | null {
  const open = sql[i];
  let close: string;
  if (open === "'" || open === '"' || open === "`") close = open;
  else if (open === "[" && rules.bracketIdentifiers) close = "]";
  else return null;
  // A backslash escapes only inside strings, never inside identifiers
  const backslash =
    (rules.backslashEscapes && (open === "'" || open === '"')) ||
    (rules.eStrings && open === "'" && opensEString(sql, i));
  let j = i + 1;
  while (j < sql.length) {
    if (backslash && sql[j] === "\\") {
      j += 2;
    } else if (sql[j] !== close) {
      j++;
    } else if (sql[j + 1] === close) {
      // A doubled closing character (`''`, `""`, `]]`) is an escaped one. The
      // span must not end here: an `E'...'` string that reopened after `''`
      // would lose its backslash escapes.
      j += 2;
    } else {
      return j;
    }
  }
  return -1;
}

export function isMultiStatementSQL(sql: string, rules: SqlStringRules) {
  const { strippedSql, parseError } = stripCommentsAndStrings(sql, rules);
  if (parseError) {
    // Parse failed, so string boundaries are unknown. Stay conservative and
    // treat any non-trailing semicolon as a statement separator.
    return stripTrailingSemicolon(sql, rules).includes(";");
  }
  // Otherwise, search the stripped SQL for semicolons
  else {
    return strippedSql.includes(";");
  }
}

// Empties strings and quoted identifiers (keeping their delimiters) and
// replaces comments with a space, so what is left is only the SQL's own
// keywords and punctuation.
function stripCommentsAndStrings(
  sql: string,
  rules: SqlStringRules,
): {
  strippedSql: string;
  parseError: boolean;
} {
  const n = sql.length;
  let strippedSql = "";
  let parseError = false;

  let i = 0;
  while (i < n) {
    const char = sql[i];
    const nextChar = sql[i + 1];
    const quoteEnd = quotedSpanEnd(sql, i, rules);
    if (quoteEnd !== null) {
      strippedSql += char;
      if (quoteEnd === -1) {
        parseError = true;
        break;
      }
      strippedSql += sql[quoteEnd];
      i = quoteEnd + 1;
    } else if (char === "-" && nextChar === "-") {
      // A comment separates tokens like whitespace, so keep a space:
      // `INTO/**/t` must still read as `INTO t`, not `INTOt`.
      strippedSql += " ";
      i += 2;
      while (i < n && sql[i] !== "\n" && sql[i] !== "\r") i++;
      i++; // Skip the line break that ends the comment
    } else if (char === "/" && nextChar === "*") {
      strippedSql += " ";
      const end = sql.indexOf("*/", i + 2);
      if (end === -1) {
        parseError = true;
        break;
      }
      i = end + 2;
    } else {
      strippedSql += char;
      i++;
    }
  }

  // Removing trailing semicolon and spaces
  strippedSql = strippedSql.replace(/;\s*$/, "").trim();

  return {
    strippedSql,
    parseError,
  };
}

type SqlResultChunkData = Pick<SqlResultChunkInterface, "numRows" | "data">;

export function encodeSQLResults(
  // Raw SQL results
  results: Record<string, unknown>[],
  // 4MB default chunk size (document max is 16MB, but leave plenty of room for overhead)
  chunkSizeBytes: number = 4_000_000,
): SqlResultChunkData[] {
  if (results.length === 0) {
    return [];
  }

  const columns = Array.from(
    results.reduce((acc, row) => {
      Object.keys(row).forEach((column) => acc.add(column));
      return acc;
    }, new Set<string>()),
  );
  const encodedResults: SqlResultChunkData[] = [];

  function createChunk(): SqlResultChunkData {
    const chunk: SqlResultChunkData = {
      numRows: 0,
      data: {},
    };
    columns.forEach((col) => {
      chunk.data[col] = [];
    });
    return chunk;
  }

  function getSize(value: unknown): number {
    if (value === null || value === undefined) return 1;
    if (typeof value === "boolean") return 1;
    if (typeof value === "number") return 8;
    if (typeof value === "string") return value.length + 5;

    // Each nested field has overhead, so just multiply by 2 to be extra conservative
    return 1 + JSON.stringify(value).length * 2;
  }

  let currentChunk = createChunk();
  let currentChunkSize = 0;

  for (const row of results) {
    currentChunk.numRows++;
    for (const col of columns) {
      const value = row[col] ?? null;
      currentChunk.data[col].push(value);
      currentChunkSize += getSize(value);
    }

    if (currentChunkSize >= chunkSizeBytes) {
      encodedResults.push(currentChunk);
      // Start a new chunk
      currentChunk = createChunk();
      currentChunkSize = 0;
    }
  }
  // Push the final chunk if it has any data
  if (currentChunkSize > 0) {
    encodedResults.push(currentChunk);
  }

  return encodedResults;
}

/**
 * Given metric filter groups where each group's conditions are ANDed together,
 * produces a minimal OR clause by removing groups that are subsumed by less
 * restrictive groups.
 *
 * Group X is subsumed by group Y if Y's conditions are a subset of X's
 * conditions — Y is less restrictive and matches all rows X matches (plus more).
 *
 * @param filterGroups - Each inner array contains SQL condition strings for one
 *   metric (ANDed together). Null values are ignored (treated as no-op filters).
 * @returns Minimal SQL condition string, or empty string if no filtering needed.
 *
 * @example
 * // Metric 1: color='blue' AND shape='circle'
 * // Metric 2: color='blue'
 * buildMinimalOrCondition([
 *   ["color='blue'", "shape='circle'"],
 *   ["color='blue'"]
 * ])
 * // Returns: "color='blue'"  (metric 1 is subsumed by metric 2)
 */
export function buildMinimalOrCondition(
  filterGroups: (string | null)[][],
): string {
  // Remove null filters and deduplicate within each group
  const cleanGroups = filterGroups.map((group) => [
    ...new Set(group.filter((f): f is string => f !== null)),
  ]);

  // An empty group (no conditions) matches everything
  // So we cannot filter anything out
  if (cleanGroups.length === 0 || cleanGroups.some((g) => g.length === 0)) {
    return "";
  }

  // Remove groups dominated by less restrictive groups.
  // Group i is dominated if another group j's conditions are a subset of i's
  // (j is less restrictive, so i is redundant in the OR).
  const groupSets = cleanGroups.map((g) => new Set(g));
  const dominated = new Set<number>();

  for (let i = 0; i < groupSets.length; i++) {
    if (dominated.has(i)) continue;
    for (let j = i + 1; j < groupSets.length; j++) {
      if (dominated.has(j)) continue;

      const iSubJ = isSubsetOf(groupSets[i], groupSets[j]);
      const jSubI = isSubsetOf(groupSets[j], groupSets[i]);

      if (iSubJ && jSubI) {
        // Equal sets — deduplicate, keep i
        dominated.add(j);
      } else if (iSubJ) {
        // i ⊆ j — i is less restrictive, j is dominated
        dominated.add(j);
      } else if (jSubI) {
        // j ⊆ i — j is less restrictive, i is dominated
        dominated.add(i);
        break;
      }
    }
  }

  const clauses: string[] = [];
  for (let i = 0; i < cleanGroups.length; i++) {
    if (dominated.has(i)) continue;
    const parts = cleanGroups[i];
    clauses.push(parts.length === 1 ? parts[0] : `(${parts.join(" AND ")})`);
  }

  if (clauses.length === 0) return "";
  if (clauses.length === 1) return clauses[0];
  return `(${clauses.join("\nOR\n")})`;
}

function isSubsetOf(a: Set<string>, b: Set<string>): boolean {
  if (a.size > b.size) return false;
  for (const item of a) {
    if (!b.has(item)) return false;
  }
  return true;
}

export function decodeSQLResults(
  chunks: SqlResultChunkData[],
): Record<string, unknown>[] {
  const results: Record<string, unknown>[] = [];

  for (const chunk of chunks) {
    const { data, numRows } = chunk;
    if (!numRows) continue;

    const columns = Object.keys(data);
    for (let i = 0; i < numRows; i++) {
      const row: Record<string, unknown> = {};
      for (const col of columns) {
        row[col] = data[col]?.[i] ?? null;
      }
      results.push(row);
    }
  }

  return results;
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
export function replaceSqlIdentifiers(
  sql: string,
  names: string[],
  replacer: (name: string, quoted: boolean) => string,
  identifierQuote: SqlIdentifierQuote = DEFAULT_IDENTIFIER_QUOTE,
  // When `matchQualified` is true, identifiers preceded by `.` (e.g. `e.price`)
  // are matched too.
  { matchQualified = false }: { matchQualified?: boolean } = {},
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
      if (
        closed &&
        (matchQualified || !isAlreadyQualified()) &&
        nameSet.has(inner)
      ) {
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
      if (
        !startsWithDigit &&
        (matchQualified || !isAlreadyQualified()) &&
        nameSet.has(token)
      ) {
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

// Whether a SQL expression references a given column identifier. String
// literals and comments are skipped, so a name inside a string literal (e.g.
// `status = 'margin_vc'`) does not count as a reference, while a quoted
// identifier (per `identifierQuote`) does. By default, qualified references
// (`e.price`) are not counted; pass `matchQualified` to include them.
export function sqlReferencesColumn(
  sql: string,
  column: string,
  identifierQuote: SqlIdentifierQuote = DEFAULT_IDENTIFIER_QUOTE,
  options: { matchQualified?: boolean } = {},
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
    options,
  );
  return found;
}

// Use when detecting whether a SELECT exposes an output column (typically
// table-aliased, e.g. `e.bandit_version`), rather than whether a bare column
// from the current table is depended upon.
export function sqlReferencesColumnAllowingQualified(
  sql: string,
  column: string,
  identifierQuote: SqlIdentifierQuote = DEFAULT_IDENTIFIER_QUOTE,
): boolean {
  return sqlReferencesColumn(sql, column, identifierQuote, {
    matchQualified: true,
  });
}
