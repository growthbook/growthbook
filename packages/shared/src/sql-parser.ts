import { DataSourceType } from "../types/datasource";
import { RowFilter } from "../types/fact-table";

/**
 * A deliberately small, conservative parser for simple non-aggregated
 * `SELECT ... FROM ... [JOIN ...] [WHERE ...] [ORDER BY ...] [LIMIT ...]`
 * statements. Anything it does not fully understand throws a SqlParseError;
 * it never guesses. Output is normalized (whitespace collapsed, keywords
 * uppercased, unquoted identifiers case-folded where the dialect allows) so
 * that equivalent spellings compare equal as strings.
 *
 * The SQL is expected to already have template variables compiled.
 */

// Aggregates accepted in the select list when `allowAggregates` is set
export type SelectAggregation = "sum" | "count" | "count distinct" | "max";

export interface SelectExpr {
  expr: string;
  // If no explicit alias, this repeats `expr`
  alias: string;
  // Set when the item is `AGG(expr)` over a GROUP BY. `expr` is then the
  // aggregate's argument (`*` for COUNT(*)).
  aggregation?: SelectAggregation;
}

export interface ParseSelectOptions {
  // Accept `SUM(x)`, `COUNT(x)`, `COUNT(DISTINCT x)`, `MAX(x)` select items
  // alongside a GROUP BY, reporting them via SelectExpr.aggregation.
  allowAggregates?: boolean;
}

export interface ParsedSelectSQL {
  select: SelectExpr[];
  // Body of the FROM clause including joins, without the FROM keyword
  from: string;
  // Top-level AND conjuncts of the WHERE clause
  where?: RowFilter[];
  // Normalized SQL of each `where` entry, index-aligned
  whereSql?: string[];
  // Body of the ORDER BY clause
  orderBy?: string;
  // Body of the LIMIT clause, e.g. "10", "10 OFFSET 5", "5, 10"
  limit?: string;
  // BigQuery `_TABLE_SUFFIX BETWEEN ...` date-partition clause (optionally an
  // OR of two such ranges, as in the GA4 intraday pattern). Pulled out of
  // `where` since it belongs in the fact table SQL, not in a row filter.
  tableSuffix?: string;
  // The statement removes duplicate rows: `SELECT DISTINCT`, or a GROUP BY
  // with no aggregates that covers every select expression. Only matters for
  // count/sum metrics, which would otherwise double count duplicate rows.
  dedupe?: boolean;
}

export class SqlParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SqlParseError";
  }
}

interface DialectRules {
  identifierQuotes: string[];
  doubleQuoteIsString: boolean;
  backslashEscapes: boolean;
  hashComments: boolean;
  // Supports r'...' raw string literals (BigQuery)
  rawStrings?: boolean;
  // Supports `col:path.to.field` semi-structured access (Snowflake)
  colonPath?: boolean;
  // Unquoted identifiers are case-insensitive in column expressions
  foldColumns: boolean;
  // Unquoted identifiers are case-insensitive in the FROM clause (table names)
  foldFrom: boolean;
}

const STANDARD: DialectRules = {
  identifierQuotes: ['"'],
  doubleQuoteIsString: false,
  backslashEscapes: false,
  hashComments: false,
  foldColumns: true,
  foldFrom: true,
};
const BACKTICK: DialectRules = {
  identifierQuotes: ["`"],
  doubleQuoteIsString: true,
  backslashEscapes: true,
  hashComments: true,
  foldColumns: true,
  // Table names are case-sensitive (BigQuery always, MySQL on Linux)
  foldFrom: false,
};
const CLICKHOUSE: DialectRules = {
  identifierQuotes: ['"', "`"],
  doubleQuoteIsString: false,
  backslashEscapes: true,
  hashComments: true,
  // ClickHouse identifiers (and function names) are case-sensitive
  foldColumns: false,
  foldFrom: false,
};

const DIALECTS: Partial<Record<DataSourceType, DialectRules>> = {
  postgres: STANDARD,
  vertica: STANDARD,
  presto: STANDARD,
  athena: STANDARD,
  redshift: { ...STANDARD, backslashEscapes: true },
  snowflake: { ...STANDARD, backslashEscapes: true, colonPath: true },
  databricks: { ...BACKTICK, hashComments: false, foldFrom: true },
  mysql: BACKTICK,
  bigquery: { ...BACKTICK, rawStrings: true },
  clickhouse: CLICKHOUSE,
  growthbook_clickhouse: CLICKHOUSE,
};

type TokenType = "ident" | "quotedIdent" | "string" | "number" | "op";
interface Token {
  type: TokenType;
  // Raw source text (quotes included for strings and quoted identifiers)
  text: string;
  // Unescaped inner value for strings/quoted identifiers. Undefined when the
  // string contains an escape sequence we don't understand.
  value?: string;
}

// Keywords that are uppercased during normalization and never treated as
// identifiers or aliases.
const KEYWORDS = new Set([
  "SELECT",
  "FROM",
  "WHERE",
  "AND",
  "OR",
  "NOT",
  "IN",
  "IS",
  "NULL",
  "LIKE",
  "ILIKE",
  "BETWEEN",
  "AS",
  "ON",
  "USING",
  "JOIN",
  "INNER",
  "LEFT",
  "RIGHT",
  "FULL",
  "OUTER",
  "CROSS",
  "NATURAL",
  "ORDER",
  "BY",
  "ASC",
  "DESC",
  "LIMIT",
  "OFFSET",
  "CASE",
  "WHEN",
  "THEN",
  "ELSE",
  "END",
  "CAST",
  "TRUE",
  "FALSE",
  "INTERVAL",
  "EXISTS",
  "UNNEST",
  "NULLS",
  "GROUP",
  "HAVING",
  "DISTINCT",
  "UNION",
  "ALL",
  "WITH",
  "OVER",
  "PARTITION",
]);

// Depth-0 keywords that start a clause of the outer statement
const CLAUSE_KEYWORDS = new Set([
  "FROM",
  "WHERE",
  "GROUP",
  "ORDER",
  "LIMIT",
  "OFFSET",
]);
const CLAUSE_ORDER = ["SELECT", "FROM", "WHERE", "GROUP", "ORDER", "LIMIT"];

// Keywords that make the statement something other than a simple select.
// Rejected at depth 0 everywhere, and at any depth outside the FROM clause.
const FORBIDDEN = new Set([
  "SELECT",
  "UNION",
  "INTERSECT",
  "EXCEPT",
  "GROUP",
  "HAVING",
  "WINDOW",
  "OVER",
  "QUALIFY",
  "DISTINCT",
  "FETCH",
  "INTO",
  "FOR",
  "LATERAL",
  "WITH",
]);

const AGGREGATES = new Set([
  "COUNT",
  "SUM",
  "AVG",
  "MIN",
  "MAX",
  "ARRAY_AGG",
  "STRING_AGG",
  "GROUP_CONCAT",
  "LISTAGG",
  "COLLECT_LIST",
  "COLLECT_SET",
  "COUNT_IF",
  "COUNTIF",
  "SUM_IF",
  "SUMIF",
  "AVGIF",
  "MINIF",
  "MAXIF",
  "ANY_VALUE",
  "ANY",
  "MEDIAN",
  "MODE",
  "STDDEV",
  "STDDEV_POP",
  "STDDEV_SAMP",
  "VARIANCE",
  "VAR_POP",
  "VAR_SAMP",
  "BOOL_AND",
  "BOOL_OR",
  "EVERY",
  "LOGICAL_AND",
  "LOGICAL_OR",
  "BIT_AND",
  "BIT_OR",
  "CORR",
  "COVAR_POP",
  "COVAR_SAMP",
  "JSON_AGG",
  "JSONB_AGG",
  "OBJECT_AGG",
  "ARRAY_CONCAT_AGG",
  "TOPK",
]);
const AGGREGATE_PREFIXES = [
  "APPROX_",
  "PERCENTILE",
  "HLL_",
  "REGR_",
  "UNIQ",
  "GROUPARRAY",
  "QUANTILE",
  "ARGMIN",
  "ARGMAX",
];

const COMPARISON_OPS = new Set(["=", "!=", "<>", "<", ">", "<=", ">="]);
const OPERATORS = [
  "!~*",
  "->>",
  "!~",
  "~*",
  "~",
  "<>",
  "!=",
  "<=",
  ">=",
  "||",
  "::",
  "->",
  "=",
  "<",
  ">",
  "+",
  "-",
  "*",
  "/",
  "%",
  ",",
  ".",
  "(",
  ")",
  "[",
  "]",
];

function fail(message: string): never {
  throw new SqlParseError(message);
}

function upper(t: Token | undefined): string | null {
  return t?.type === "ident" ? t.text.toUpperCase() : null;
}
function isKw(t: Token | undefined, ...words: string[]): boolean {
  const u = upper(t);
  return u !== null && words.includes(u);
}
function isOp(t: Token | undefined, ...ops: string[]): boolean {
  return t?.type === "op" && ops.includes(t.text);
}
// An identifier usable as a column/alias name (not a keyword)
function isName(t: Token | undefined): boolean {
  if (!t) return false;
  if (t.type === "quotedIdent") return true;
  return t.type === "ident" && !KEYWORDS.has(t.text.toUpperCase());
}
function depthDelta(t: Token): number {
  if (isOp(t, "(", "[")) return 1;
  if (isOp(t, ")", "]")) return -1;
  return 0;
}

// Reads a quote-delimited span starting at `start` (the opening quote).
// Doubled quotes always escape; backslash escapes when enabled.
function readQuoted(
  sql: string,
  start: number,
  quote: string,
  backslashEscapes: boolean,
): { end: number; value: string | undefined } {
  let i = start + 1;
  let value: string | undefined = "";
  while (i < sql.length) {
    const c = sql[i];
    if (backslashEscapes && c === "\\") {
      const next = sql[i + 1];
      if (next === undefined) break;
      if (next === "\\" || next === "'" || next === '"' || next === "`") {
        if (value !== undefined) value += next;
      } else {
        // \n, \t, \x41, ... — we don't interpret these, so the literal value
        // is unknown and the caller must keep the raw text instead.
        value = undefined;
      }
      i += 2;
      continue;
    }
    if (c === quote) {
      if (sql[i + 1] === quote) {
        if (value !== undefined) value += quote;
        i += 2;
        continue;
      }
      return { end: i + 1, value };
    }
    if (value !== undefined) value += c;
    i++;
  }
  return fail(`Unterminated ${quote} quote`);
}

function tokenize(sql: string, rules: DialectRules): Token[] {
  const tokens: Token[] = [];
  const n = sql.length;
  let i = 0;
  // End index of the previous token, to detect adjacency like r'...'
  let lastEnd = -1;

  const push = (t: Token, end: number) => {
    tokens.push(t);
    lastEnd = end;
    i = end;
  };

  while (i < n) {
    const c = sql[i];
    const next = sql[i + 1];

    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if ((c === "-" && next === "-") || (c === "#" && rules.hashComments)) {
      while (i < n && sql[i] !== "\n" && sql[i] !== "\r") i++;
      continue;
    }
    if (c === "/" && next === "*") {
      const end = sql.indexOf("*/", i + 2);
      if (end < 0) fail("Unterminated block comment");
      i = end + 2;
      continue;
    }
    if (c === ";") {
      if (sql.slice(i + 1).trim() !== "") fail("Multiple statements");
      break;
    }

    const prev = tokens[tokens.length - 1];
    const isQuote =
      c === "'" || c === '"' || rules.identifierQuotes.includes(c);
    if (isQuote) {
      // A short identifier glued to a quote is a literal prefix (r'..', b'..',
      // x'..', e'..', n'..'). Longer words glued to a quote (`like'x'`,
      // `interval'1 day'`) are just missing whitespace.
      const isPrefix =
        prev?.type === "ident" &&
        lastEnd === i &&
        /^[rbxenu]{1,2}$/i.test(prev.text);
      if (isPrefix) {
        // BigQuery raw string: r'...' — no escape processing, but a
        // backslash still prevents the following quote from terminating it.
        if (
          rules.rawStrings &&
          c === "'" &&
          prev.type === "ident" &&
          /^r$/i.test(prev.text)
        ) {
          let j = i + 1;
          while (j < sql.length && sql[j] !== "'") j += sql[j] === "\\" ? 2 : 1;
          if (j >= sql.length) fail("Unterminated ' quote");
          tokens.pop();
          push({ type: "string", text: sql.slice(i - 1, j + 1) }, j + 1);
          continue;
        }
        fail(`Unsupported prefix before quoted text: ${prev.text}`);
      }
      if (
        prev &&
        lastEnd === i &&
        prev.type !== "op" &&
        prev.type !== "ident"
      ) {
        fail(`Unexpected quote after ${prev.text}`);
      }
      const { end, value } = readQuoted(sql, i, c, rules.backslashEscapes);
      const text = sql.slice(i, end);
      if (c === "'" || (c === '"' && rules.doubleQuoteIsString)) {
        push({ type: "string", text, value }, end);
      } else if (rules.identifierQuotes.includes(c)) {
        if (value === undefined) fail(`Unsupported escape in ${text}`);
        push({ type: "quotedIdent", text, value }, end);
      } else {
        fail(`Unsupported quote character ${c}`);
      }
      continue;
    }

    const numberMatch = /^(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?/.exec(
      sql.slice(i),
    );
    if (
      numberMatch &&
      // `.5` is a number, but `t.5` is not
      (c !== "." || !prev || (prev.type === "op" && !isOp(prev, ")", "]")))
    ) {
      push({ type: "number", text: numberMatch[0] }, i + numberMatch[0].length);
      continue;
    }

    const identMatch = /^[A-Za-z_][A-Za-z0-9_$]*/.exec(sql.slice(i));
    if (identMatch) {
      push({ type: "ident", text: identMatch[0] }, i + identMatch[0].length);
      continue;
    }

    let op = OPERATORS.find((o) => sql.startsWith(o, i));
    if (!op && c === ":" && rules.colonPath) op = ":";
    if (op) {
      push({ type: "op", text: op }, i + op.length);
      continue;
    }

    return fail(`Unexpected character "${c}"`);
  }

  return tokens;
}

function normalize(tokens: Token[], fold: boolean): string {
  let out = "";
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    let text = t.text;
    if (t.type === "ident") {
      const u = t.text.toUpperCase();
      text = KEYWORDS.has(u) ? u : fold ? t.text.toLowerCase() : t.text;
    }
    const prev = tokens[i - 1];
    // Function calls and subscripts: `lower(x)`, `CAST(x AS int)`, `arr[OFFSET(0)]`
    const isCall =
      isOp(t, "(", "[") &&
      (prev?.type === "quotedIdent" ||
        (prev?.type === "ident" &&
          (!KEYWORDS.has(prev.text.toUpperCase()) ||
            isKw(prev, "CAST", "UNNEST", "OFFSET"))) ||
        (isOp(t, "[") && isOp(prev, ")", "]")));
    const noSpace =
      !prev ||
      isCall ||
      isOp(prev, "(", "[", ".", "::", ":") ||
      isOp(t, ")", "]", ",", ".", "::", ":");
    out += (noSpace ? "" : " ") + text;
  }
  return out;
}

// Split at depth-0 tokens matching `isSeparator`
function splitTopLevel(
  tokens: Token[],
  isSeparator: (t: Token, prevTokens: Token[]) => boolean,
): Token[][] {
  const parts: Token[][] = [[]];
  let depth = 0;
  for (const t of tokens) {
    if (depth === 0 && isSeparator(t, parts[parts.length - 1])) {
      parts.push([]);
      continue;
    }
    depth += depthDelta(t);
    if (depth < 0) fail("Unbalanced parentheses");
    parts[parts.length - 1].push(t);
  }
  if (depth !== 0) fail("Unbalanced parentheses");
  return parts;
}

// Reject constructs that make this more than a simple select (any depth).
// A parenthesized `(SELECT ...)` is a per-row scalar expression (e.g. the GA4
// `(SELECT value FROM UNNEST(event_params) WHERE key = 'x')` pattern), so its
// contents are opaque, like the FROM clause.
function assertSimpleExpression(tokens: Token[], clause: string) {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (isOp(t, "(") && isKw(tokens[i + 1], "SELECT")) {
      let depth = 0;
      do {
        depth += depthDelta(tokens[i]);
        i++;
      } while (depth > 0 && i < tokens.length);
      i--;
      continue;
    }
    const u = upper(t);
    if (u !== null) {
      if (FORBIDDEN.has(u)) fail(`Unsupported ${u} in ${clause}`);
      if (
        isOp(tokens[i + 1], "(") &&
        (AGGREGATES.has(u) || AGGREGATE_PREFIXES.some((p) => u.startsWith(p)))
      ) {
        fail(`Aggregate function ${t.text}() is not supported in ${clause}`);
      }
    }
    if (isOp(t, ".") && isOp(tokens[i + 1], "*")) {
      fail(`Unsupported wildcard in ${clause}`);
    }
  }
}

// Split a select item into its expression and optional alias token
function splitAlias(tokens: Token[]): {
  exprTokens: Token[];
  aliasToken?: Token;
} {
  let depth = 0;
  let asIdx = -1;
  for (let i = 0; i < tokens.length; i++) {
    depth += depthDelta(tokens[i]);
    if (depth === 0 && isKw(tokens[i], "AS")) {
      if (asIdx >= 0) fail("Multiple AS in select expression");
      asIdx = i;
    }
  }

  let exprTokens = tokens;
  let aliasToken: Token | undefined;
  if (asIdx >= 0) {
    exprTokens = tokens.slice(0, asIdx);
    if (tokens.length !== asIdx + 2) fail("Invalid alias in select expression");
    aliasToken = tokens[asIdx + 1];
    if (!isName(aliasToken)) fail(`Invalid alias ${aliasToken.text}`);
  } else if (tokens.length >= 2) {
    const last = tokens[tokens.length - 1];
    const prev = tokens[tokens.length - 2];
    // Bare alias: `expr alias`. The token before it must be able to end an
    // expression, otherwise `NOT x` or `a - b` would be misread as aliased.
    const prevEndsExpr =
      isName(prev) ||
      prev.type === "string" ||
      prev.type === "number" ||
      isOp(prev, ")", "]") ||
      isKw(prev, "END", "NULL", "TRUE", "FALSE");
    if (isName(last) && prevEndsExpr) {
      exprTokens = tokens.slice(0, -1);
      aliasToken = last;
    }
  }

  if (!exprTokens.length) fail("Empty select expression");
  return { exprTokens, aliasToken };
}

function parseSelectItem(tokens: Token[], fold: boolean): SelectExpr {
  const { exprTokens, aliasToken } = splitAlias(tokens);
  if (isOp(exprTokens[0], "*") && exprTokens.length === 1) {
    fail("Wildcard * must be the only select expression");
  }
  const expr = normalize(exprTokens, fold);
  // A bare column reference is named after its last segment by every engine
  // (`t.user_id` -> user_id), so mirror that for the implicit alias.
  const nameToken =
    aliasToken ??
    (isColumn(exprTokens) ? exprTokens[exprTokens.length - 1] : undefined);
  return { expr, alias: nameToken ? aliasName(nameToken, fold) : expr };
}

const SELECT_AGGREGATES: Record<string, SelectAggregation> = {
  SUM: "sum",
  COUNT: "count",
  MAX: "max",
};

// `SUM(x) AS value` -> { expr: "x", alias: "value", aggregation: "sum" }.
// Returns null when the item is not a whole-item aggregate call.
function parseAggregateItem(tokens: Token[], fold: boolean): SelectExpr | null {
  const { exprTokens, aliasToken } = splitAlias(tokens);
  const fn = upper(exprTokens[0]);
  if (
    fn === null ||
    !(fn in SELECT_AGGREGATES) ||
    !isOp(exprTokens[1], "(") ||
    !isOp(exprTokens[exprTokens.length - 1], ")")
  ) {
    return null;
  }
  // The opening paren must close at the very end: `SUM(x) + 1` is not an aggregate item
  let depth = 0;
  for (let i = 1; i < exprTokens.length - 1; i++) {
    depth += depthDelta(exprTokens[i]);
    if (depth === 0) return null;
  }
  let inner = exprTokens.slice(2, -1);
  let aggregation = SELECT_AGGREGATES[fn];
  if (isKw(inner[0], "DISTINCT")) {
    if (aggregation !== "count") fail(`${fn}(DISTINCT ...) is not supported`);
    aggregation = "count distinct";
    inner = inner.slice(1);
  }
  if (!inner.length) fail(`Empty ${fn}() in SELECT`);
  assertSimpleExpression(inner, "SELECT");
  const expr = normalize(inner, fold);
  return {
    expr,
    alias: aliasToken
      ? aliasName(aliasToken, fold)
      : `${fn.toLowerCase()}(${expr})`,
    aggregation,
  };
}

// Output column name for an alias or column token. Quotes are dropped when
// they change nothing, so `"user_id"` and `user_id` match; a quoted name that
// needs its quotes (mixed case, reserved word) keeps them.
function aliasName(token: Token, fold: boolean): string {
  if (token.type === "quotedIdent" && token.value !== undefined) {
    const safe = fold
      ? /^[a-z_][a-z0-9_]*$/.test(token.value)
      : /^[A-Za-z_][A-Za-z0-9_]*$/.test(token.value);
    if (safe && !KEYWORDS.has(token.value.toUpperCase())) return token.value;
  }
  return normalize([token], fold);
}

function literalValue(tokens: Token[]): string | undefined {
  if (tokens.length === 1) {
    const t = tokens[0];
    if (t.type === "number") return t.text;
    if (t.type === "string") return t.value;
  }
  if (
    tokens.length === 2 &&
    isOp(tokens[0], "-") &&
    tokens[1].type === "number"
  ) {
    return "-" + tokens[1].text;
  }
  return undefined;
}

// `col`, `t.col`, `"T"."Col"`
function isColumn(tokens: Token[]): boolean {
  if (!tokens.length || tokens.length % 2 === 0) return false;
  return tokens.every((t, i) => (i % 2 === 0 ? isName(t) : isOp(t, ".")));
}

// Unwrap fully enclosing parentheses
function stripParens(tokens: Token[]): Token[] {
  while (
    tokens.length >= 2 &&
    isOp(tokens[0], "(") &&
    isOp(tokens[tokens.length - 1], ")")
  ) {
    let depth = 0;
    for (let i = 0; i < tokens.length - 1; i++) {
      depth += depthDelta(tokens[i]);
      if (depth === 0) return tokens;
    }
    tokens = tokens.slice(1, -1);
  }
  return tokens;
}

function isTautology(tokens: Token[]): boolean {
  if (tokens.length === 1) {
    return tokens[0].text === "1" || isKw(tokens[0], "TRUE");
  }
  return (
    tokens.length === 3 &&
    tokens[0].text === "1" &&
    isOp(tokens[1], "=") &&
    tokens[2].text === "1"
  );
}

function conjunctToRowFilter(tokens: Token[], fold: boolean): RowFilter {
  tokens = stripParens(tokens);
  const sqlExpr = (): RowFilter => ({
    operator: "sql_expr",
    values: [normalize(tokens, fold)],
  });
  const filter = (
    operator: RowFilter["operator"],
    columnTokens: Token[],
    values?: string[],
  ): RowFilter => ({
    operator,
    column: normalize(columnTokens, fold),
    ...(values ? { values } : {}),
  });

  // `col = 'a' OR col IN ('b', 'c')` on a single column is exactly an IN list
  const disjuncts = splitTopLevel(tokens, (t) => isKw(t, "OR"));
  if (disjuncts.length > 1) {
    if (disjuncts.some((d) => !d.length))
      fail("Empty condition in WHERE clause");
    const parts = disjuncts.map((d) => conjunctToRowFilter(d, fold));
    const column = parts[0].column;
    if (
      column !== undefined &&
      parts.every(
        (f) =>
          (f.operator === "=" || f.operator === "in") && f.column === column,
      )
    ) {
      return {
        operator: "in",
        column,
        values: parts.flatMap((f) => f.values ?? []),
      };
    }
    return sqlExpr();
  }

  if (isColumn(tokens)) return filter("is_true", tokens);
  if (isKw(tokens[0], "NOT") && isColumn(tokens.slice(1))) {
    return filter("is_false", tokens.slice(1));
  }

  // Find the first depth-0 operator/keyword that splits left and right
  let depth = 0;
  let opIdx = -1;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (
      depth === 0 &&
      ((t.type === "op" && COMPARISON_OPS.has(t.text)) ||
        isKw(t, "IS", "IN", "NOT", "BETWEEN", "LIKE"))
    ) {
      opIdx = i;
      break;
    }
    depth += depthDelta(t);
  }
  if (opIdx < 0) return sqlExpr();

  const left = tokens.slice(0, opIdx);
  if (!isColumn(left)) {
    // `literal op col` → mirror the comparison
    const op = tokens[opIdx];
    const right = tokens.slice(opIdx + 1);
    const value = literalValue(left);
    if (
      op.type === "op" &&
      COMPARISON_OPS.has(op.text) &&
      value !== undefined &&
      isColumn(right)
    ) {
      const mirrored: Record<string, RowFilter["operator"]> = {
        "=": "=",
        "!=": "!=",
        "<>": "!=",
        "<": ">",
        ">": "<",
        "<=": ">=",
        ">=": "<=",
      };
      return filter(mirrored[op.text], right, [value]);
    }
    return sqlExpr();
  }

  let i = opIdx;
  let negated = false;
  if (isKw(tokens[i], "NOT")) {
    negated = true;
    i++;
  }
  const op = tokens[i];
  const right = tokens.slice(i + 1);

  if (!negated && op.type === "op" && COMPARISON_OPS.has(op.text)) {
    if (op.text === "=" && right.length === 1 && isKw(right[0], "TRUE")) {
      return filter("is_true", left);
    }
    if (op.text === "=" && right.length === 1 && isKw(right[0], "FALSE")) {
      return filter("is_false", left);
    }
    const value = literalValue(right);
    if (value === undefined) return sqlExpr();
    const operator = op.text === "<>" ? "!=" : op.text;
    return filter(operator as RowFilter["operator"], left, [value]);
  }

  if (!negated && isKw(op, "IS")) {
    if (right.length === 1 && isKw(right[0], "NULL")) {
      return filter("is_null", left);
    }
    if (right.length === 1 && isKw(right[0], "TRUE")) {
      return filter("is_true", left);
    }
    if (right.length === 1 && isKw(right[0], "FALSE")) {
      return filter("is_false", left);
    }
    if (right.length === 2 && isKw(right[0], "NOT") && isKw(right[1], "NULL")) {
      return filter("not_null", left);
    }
    return sqlExpr();
  }

  if (isKw(op, "IN")) {
    if (!isOp(right[0], "(") || !isOp(right[right.length - 1], ")")) {
      return sqlExpr();
    }
    const items = splitTopLevel(right.slice(1, -1), (t) => isOp(t, ","));
    const values = items.map(literalValue);
    if (!values.length || values.some((v) => v === undefined)) {
      return sqlExpr();
    }
    return filter(negated ? "not_in" : "in", left, values as string[]);
  }

  if (isKw(op, "BETWEEN")) {
    const bounds = splitTopLevel(right, (t) => isKw(t, "AND"));
    if (bounds.length !== 2) return sqlExpr();
    const lower = literalValue(bounds[0]);
    const upperBound = literalValue(bounds[1]);
    if (lower === undefined || upperBound === undefined) return sqlExpr();
    return filter(negated ? "not_between" : "between", left, [
      lower,
      upperBound,
    ]);
  }

  if (isKw(op, "LIKE")) {
    if (right.length !== 1 || right[0].type !== "string") return sqlExpr();
    const pattern = right[0].value;
    if (pattern === undefined) return sqlExpr();
    const leading = pattern.startsWith("%");
    const trailing = pattern.endsWith("%") && pattern.length > 1;
    const inner = pattern.slice(leading ? 1 : 0, trailing ? -1 : undefined);
    if (!inner || /[%_\\]/.test(inner) || (!leading && !trailing)) {
      return sqlExpr();
    }
    if (leading && trailing) {
      return filter(negated ? "not_contains" : "contains", left, [inner]);
    }
    if (negated) return sqlExpr();
    return filter(trailing ? "starts_with" : "ends_with", left, [inner]);
  }

  return sqlExpr();
}

// Split on top-level AND (except the AND that belongs to a BETWEEN), then
// unwrap parentheses and split again so `(a AND b) AND c` yields three parts.
function splitConjuncts(tokens: Token[]): Token[][] {
  const parts = splitTopLevel(tokens, (t, prev) => {
    if (!isKw(t, "AND")) return false;
    let depth = 0;
    let pendingBetween = false;
    for (const p of prev) {
      depth += depthDelta(p);
      if (depth === 0 && isKw(p, "BETWEEN")) pendingBetween = true;
      else if (depth === 0 && isKw(p, "AND")) pendingBetween = false;
    }
    return !pendingBetween;
  });
  return parts.flatMap((part) => {
    if (!part.length) fail("Empty condition in WHERE clause");
    const stripped = stripParens(part);
    return stripped.length < part.length ? splitConjuncts(stripped) : [part];
  });
}

// `[t.]_TABLE_SUFFIX BETWEEN lit AND lit`, or an OR of several such ranges
function isTableSuffixRange(tokens: Token[]): boolean {
  const disjuncts = splitTopLevel(tokens, (t) => isKw(t, "OR"));
  return disjuncts.every((d) => {
    d = stripParens(d);
    const betweenIdx = d.findIndex((t) => isKw(t, "BETWEEN"));
    if (betweenIdx < 1) return false;
    const col = d.slice(0, betweenIdx);
    if (!isColumn(col)) return false;
    if (col[col.length - 1].text.toUpperCase() !== "_TABLE_SUFFIX")
      return false;
    const bounds = splitTopLevel(d.slice(betweenIdx + 1), (t) =>
      isKw(t, "AND"),
    );
    return (
      bounds.length === 2 &&
      bounds.every((b) => b.length === 1 && b[0].type === "string")
    );
  });
}

function parseWhere(
  tokens: Token[],
  fold: boolean,
): Pick<ParsedSelectSQL, "where" | "whereSql" | "tableSuffix"> {
  if (!tokens.length) fail("Empty WHERE clause");
  const filters: RowFilter[] = [];
  const whereSql: string[] = [];
  let tableSuffix: string | undefined;
  for (const conjunct of splitConjuncts(tokens)) {
    if (isTautology(conjunct)) continue;
    if (isTableSuffixRange(conjunct)) {
      if (tableSuffix !== undefined) fail("Multiple _TABLE_SUFFIX clauses");
      tableSuffix = normalize(stripParens(conjunct), fold);
      continue;
    }
    filters.push(conjunctToRowFilter(conjunct, fold));
    whereSql.push(normalize(stripParens(conjunct), fold));
  }
  return {
    ...(filters.length ? { where: filters, whereSql } : {}),
    ...(tableSuffix !== undefined ? { tableSuffix } : {}),
  };
}

export function parseSelectSQL(
  sql: string,
  type: DataSourceType,
  options: ParseSelectOptions = {},
): ParsedSelectSQL {
  const rules = DIALECTS[type];
  if (!rules) fail(`Unsupported dialect: ${type}`);

  const tokens = tokenize(sql, rules);
  if (isKw(tokens[0], "WITH")) fail("CTEs (WITH) are not supported");
  if (!isKw(tokens[0], "SELECT")) fail("Statement must start with SELECT");

  // Split into clauses at depth-0 clause keywords
  const clauses: { keyword: string; tokens: Token[] }[] = [
    { keyword: "SELECT", tokens: [] },
  ];
  let dedupe = false;
  if (isKw(tokens[1], "DISTINCT")) {
    dedupe = true;
    tokens.splice(1, 1);
  }
  let depth = 0;
  for (const t of tokens.slice(1)) {
    const u = upper(t);
    const current = clauses[clauses.length - 1];
    if (depth === 0 && u !== null) {
      if (FORBIDDEN.has(u) && !CLAUSE_KEYWORDS.has(u)) {
        fail(`Unsupported ${u} clause`);
      }
      if (CLAUSE_KEYWORDS.has(u)) {
        if (u === "OFFSET") {
          if (current.keyword !== "LIMIT") fail("OFFSET requires LIMIT");
        } else {
          if (
            CLAUSE_ORDER.indexOf(u) <= CLAUSE_ORDER.indexOf(current.keyword)
          ) {
            fail(`Unexpected ${u} clause`);
          }
          clauses.push({ keyword: u, tokens: [] });
          continue;
        }
      }
    }
    depth += depthDelta(t);
    if (depth < 0) fail("Unbalanced parentheses");
    current.tokens.push(t);
  }
  if (depth !== 0) fail("Unbalanced parentheses");

  const clause = (kw: string) => clauses.find((c) => c.keyword === kw)?.tokens;
  const selectTokens = clause("SELECT") || [];
  const fromTokens = clause("FROM");
  const whereTokens = clause("WHERE");
  const groupTokens = clause("GROUP");
  const orderTokens = clause("ORDER");
  const limitTokens = clause("LIMIT");

  if (!fromTokens) fail("Missing FROM clause");
  if (!fromTokens.length) fail("Empty FROM clause");

  // SELECT
  const items = splitTopLevel(selectTokens, (t) => isOp(t, ","));
  // BigQuery and Snowflake allow a trailing comma before FROM
  if (items.length > 1 && items[items.length - 1].length === 0) items.pop();
  let select: SelectExpr[];
  if (items.length === 1 && items[0].length === 1 && isOp(items[0][0], "*")) {
    select = [{ expr: "*", alias: "*" }];
  } else {
    select = items.map((item) => {
      const aggregate =
        options.allowAggregates && groupTokens
          ? parseAggregateItem(item, rules.foldColumns)
          : null;
      if (aggregate) return aggregate;
      assertSimpleExpression(item, "SELECT");
      return parseSelectItem(item, rules.foldColumns);
    });
  }
  const aggregated = select.some((c) => c.aggregation);

  // GROUP BY without aggregates is just DISTINCT, provided it covers every
  // select expression. With aggregates it must cover every non-aggregated one.
  if (groupTokens) {
    if (!isKw(groupTokens[0], "BY") || groupTokens.length < 2) {
      fail("Invalid GROUP BY clause");
    }
    const body = groupTokens.slice(1);
    if (!(body.length === 1 && isKw(body[0], "ALL"))) {
      if (select[0].expr === "*")
        fail("GROUP BY with SELECT * is not supported");
      assertSimpleExpression(body, "GROUP BY");
      const covered = new Set<number>();
      for (const item of splitTopLevel(body, (t) => isOp(t, ","))) {
        const position =
          item.length === 1 && item[0].type === "number"
            ? Number(item[0].text)
            : NaN;
        const text = normalize(item, rules.foldColumns);
        const idx = Number.isInteger(position)
          ? position - 1
          : select.findIndex((c) => c.expr === text || c.alias === text);
        if (idx >= select.length)
          fail(`GROUP BY position ${position} is out of range`);
        // With aggregates, grouping by an unselected column only changes the
        // pre-aggregation granularity, which re-aggregating the rows undoes
        if (idx < 0 && !aggregated) {
          fail(`GROUP BY item is not a select expression: ${text}`);
        }
        if (idx >= 0) covered.add(idx);
      }
      // Constant literals (`1 AS value`) don't need to be grouped
      const isConstant = (expr: string) =>
        /^-?\d+(\.\d+)?$/.test(expr) || /^'([^']|'')*'$/.test(expr);
      select.forEach((c, i) => {
        if (!covered.has(i) && !isConstant(c.expr) && !c.aggregation) {
          fail(`GROUP BY does not cover select expression: ${c.expr}`);
        }
      });
    }
    if (!aggregated) dedupe = true;
  }

  const result: ParsedSelectSQL = {
    select,
    from: normalize(fromTokens, rules.foldFrom),
    ...(dedupe ? { dedupe } : {}),
  };

  if (whereTokens) {
    assertSimpleExpression(whereTokens, "WHERE");
    Object.assign(result, parseWhere(whereTokens, rules.foldColumns));
  }

  if (orderTokens) {
    if (!isKw(orderTokens[0], "BY") || orderTokens.length < 2) {
      fail("Invalid ORDER BY clause");
    }
    const body = orderTokens.slice(1);
    assertSimpleExpression(body, "ORDER BY");
    result.orderBy = normalize(body, rules.foldColumns);
  }

  if (limitTokens) {
    const valid =
      limitTokens.length > 0 &&
      limitTokens.every(
        (t) => t.type === "number" || isOp(t, ",") || isKw(t, "OFFSET"),
      );
    if (!valid) fail("Invalid LIMIT clause");
    result.limit = normalize(limitTokens, false);
  }

  return result;
}
