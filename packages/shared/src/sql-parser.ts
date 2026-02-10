import { RowFilter } from "shared/types/fact-table";

// ─── Types ───────────────────────────────────────────────────────────────────

export class SqlParseError extends Error {
  position: number;
  constructor(message: string, position: number) {
    super(message);
    this.name = "SqlParseError";
    this.position = position;
  }
}

export interface SelectItem {
  expr: string;
  alias: string | null;
}

export interface FromClause {
  table: string;
  alias: string | null;
}

export interface JoinClause {
  joinType: string;
  table: string;
  alias: string | null;
  on: string | null;
  using: string[] | null;
}

export interface OrderByItem {
  expr: string;
  direction: "ASC" | "DESC" | null;
  nulls: "FIRST" | "LAST" | null;
}

export interface CteClause {
  name: string;
  columns: string[] | null;
  body: string;
}

export interface ParsedSelect {
  ctes: CteClause[];
  select: SelectItem[];
  distinct: boolean;
  from: FromClause | null;
  joins: JoinClause[];
  where: string | null;
  groupBy: string[];
  having: string | null;
  orderBy: OrderByItem[];
  limit: string | null;
  offset: string | null;
}

// ─── Token types ─────────────────────────────────────────────────────────────

type TokenType =
  | "keyword"
  | "identifier"
  | "string"
  | "number"
  | "operator"
  | "punctuation"
  | "quoted_identifier";

interface Token {
  type: TokenType;
  value: string;
  /** Original text as it appeared in the SQL (preserves quoting) */
  raw: string;
  position: number;
}

// ─── Keyword set ─────────────────────────────────────────────────────────────

const KEYWORDS = new Set([
  "SELECT",
  "DISTINCT",
  "ALL",
  "AS",
  "FROM",
  "JOIN",
  "INNER",
  "LEFT",
  "RIGHT",
  "FULL",
  "CROSS",
  "NATURAL",
  "OUTER",
  "ON",
  "USING",
  "WHERE",
  "GROUP",
  "BY",
  "HAVING",
  "ORDER",
  "ASC",
  "DESC",
  "LIMIT",
  "OFFSET",
  "FETCH",
  "FIRST",
  "NEXT",
  "ROW",
  "ROWS",
  "ONLY",
  "AND",
  "OR",
  "NOT",
  "IN",
  "IS",
  "NULL",
  "NULLS",
  "LAST",
  "LIKE",
  "ILIKE",
  "BETWEEN",
  "EXISTS",
  "CASE",
  "WHEN",
  "THEN",
  "ELSE",
  "END",
  "CAST",
  "TRUE",
  "FALSE",
  "UNION",
  "INTERSECT",
  "EXCEPT",
  "WITH",
  "INSERT",
  "UPDATE",
  "DELETE",
  "CREATE",
  "DROP",
  "ALTER",
  "TRUNCATE",
  "INTO",
  "SET",
  "VALUES",
  "TABLE",
  "INDEX",
  "VIEW",
  "IF",
  "OVER",
  "PARTITION",
  "WINDOW",
  "FILTER",
  "LATERAL",
  "RECURSIVE",
  "MATERIALIZED",
]);

// ─── Phase 1: Tokenizer ─────────────────────────────────────────────────────

export function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  const n = sql.length;
  let i = 0;

  while (i < n) {
    const ch = sql[i];

    // Whitespace — skip
    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    // Line comment
    if (ch === "-" && i + 1 < n && sql[i + 1] === "-") {
      i += 2;
      while (i < n && sql[i] !== "\n" && sql[i] !== "\r") i++;
      continue;
    }

    // Block comment
    if (ch === "/" && i + 1 < n && sql[i + 1] === "*") {
      const start = i;
      i += 2;
      while (i < n) {
        if (sql[i] === "*" && i + 1 < n && sql[i + 1] === "/") {
          i += 2;
          break;
        }
        i++;
      }
      if (i >= n && !(sql[n - 2] === "*" && sql[n - 1] === "/")) {
        throw new SqlParseError("Unterminated block comment", start);
      }
      continue;
    }

    // Single-quoted string
    if (ch === "'") {
      const start = i;
      i++;
      let value = "";
      while (i < n) {
        if (sql[i] === "\\") {
          value += sql[i + 1] ?? "";
          i += 2;
          continue;
        }
        if (sql[i] === "'") {
          if (i + 1 < n && sql[i + 1] === "'") {
            value += "'";
            i += 2;
            continue;
          }
          break;
        }
        value += sql[i];
        i++;
      }
      if (i >= n) {
        throw new SqlParseError("Unterminated string literal", start);
      }
      const raw = sql.slice(start, i + 1);
      tokens.push({ type: "string", value, raw, position: start });
      i++;
      continue;
    }

    // Double-quoted identifier
    if (ch === '"') {
      const start = i;
      i++;
      let value = "";
      while (i < n) {
        if (sql[i] === "\\") {
          value += sql[i + 1] ?? "";
          i += 2;
          continue;
        }
        if (sql[i] === '"') {
          if (i + 1 < n && sql[i + 1] === '"') {
            value += '"';
            i += 2;
            continue;
          }
          break;
        }
        value += sql[i];
        i++;
      }
      if (i >= n) {
        throw new SqlParseError("Unterminated quoted identifier", start);
      }
      const raw = sql.slice(start, i + 1);
      tokens.push({ type: "quoted_identifier", value, raw, position: start });
      i++;
      continue;
    }

    // Backtick-quoted identifier
    if (ch === "`") {
      const start = i;
      i++;
      let value = "";
      while (i < n) {
        if (sql[i] === "`") {
          if (i + 1 < n && sql[i + 1] === "`") {
            value += "`";
            i += 2;
            continue;
          }
          break;
        }
        value += sql[i];
        i++;
      }
      if (i >= n) {
        throw new SqlParseError("Unterminated backtick identifier", start);
      }
      const raw = sql.slice(start, i + 1);
      tokens.push({ type: "quoted_identifier", value, raw, position: start });
      i++;
      continue;
    }

    // Numbers (digits, possibly with decimals)
    if (
      /[0-9]/.test(ch) ||
      (ch === "." && i + 1 < n && /[0-9]/.test(sql[i + 1]))
    ) {
      const start = i;
      // integer part
      while (i < n && /[0-9]/.test(sql[i])) i++;
      // decimal part
      if (i < n && sql[i] === ".") {
        i++;
        while (i < n && /[0-9]/.test(sql[i])) i++;
      }
      // exponent part
      if (i < n && (sql[i] === "e" || sql[i] === "E")) {
        i++;
        if (i < n && (sql[i] === "+" || sql[i] === "-")) i++;
        while (i < n && /[0-9]/.test(sql[i])) i++;
      }
      const raw = sql.slice(start, i);
      tokens.push({ type: "number", value: raw, raw, position: start });
      continue;
    }

    // Multi-character operators
    if (i + 1 < n) {
      const two = sql.slice(i, i + 2);
      if (
        two === "!=" ||
        two === "<>" ||
        two === ">=" ||
        two === "<=" ||
        two === "||" ||
        two === "::"
      ) {
        tokens.push({ type: "operator", value: two, raw: two, position: i });
        i += 2;
        continue;
      }
    }

    // Single-character operators
    if ("+-*/%=<>".includes(ch)) {
      tokens.push({ type: "operator", value: ch, raw: ch, position: i });
      i++;
      continue;
    }

    // Punctuation: parens, comma, semicolon, dot
    if ("(),.;".includes(ch)) {
      tokens.push({ type: "punctuation", value: ch, raw: ch, position: i });
      i++;
      continue;
    }

    // Words (identifiers / keywords)
    if (/[a-zA-Z_]/.test(ch)) {
      const start = i;
      while (i < n && /[a-zA-Z0-9_$]/.test(sql[i])) i++;
      const raw = sql.slice(start, i);
      const upper = raw.toUpperCase();
      const type: TokenType = KEYWORDS.has(upper) ? "keyword" : "identifier";
      tokens.push({ type, value: raw, raw, position: start });
      continue;
    }

    // Other single characters (e.g. @, #, ~, etc.) — treat as operator
    tokens.push({ type: "operator", value: ch, raw: ch, position: i });
    i++;
  }

  return tokens;
}

// ─── Phase 2: Clause Splitter ────────────────────────────────────────────────

interface RawClause {
  type: string;
  tokens: Token[];
  position: number;
}

// Join keywords that start a JOIN clause
const JOIN_STARTERS = new Set([
  "JOIN",
  "INNER",
  "LEFT",
  "RIGHT",
  "FULL",
  "CROSS",
  "NATURAL",
]);

// Non-SELECT statements we explicitly reject
const REJECTED_STATEMENTS = new Set([
  "INSERT",
  "UPDATE",
  "DELETE",
  "CREATE",
  "DROP",
  "ALTER",
  "TRUNCATE",
]);

// Set operations we reject
const SET_OPERATIONS = new Set(["UNION", "INTERSECT", "EXCEPT"]);

function isJoinStart(tokens: Token[], idx: number): string | null {
  const t = tokens[idx];
  if (t.type !== "keyword") return null;
  const upper = t.value.toUpperCase();

  if (upper === "JOIN") return "JOIN";

  if (upper === "NATURAL") {
    // NATURAL [LEFT|RIGHT|FULL|INNER] [OUTER] JOIN
    let j = idx + 1;
    const parts = ["NATURAL"];
    if (
      j < tokens.length &&
      tokens[j].type === "keyword" &&
      ["LEFT", "RIGHT", "FULL", "INNER"].includes(tokens[j].value.toUpperCase())
    ) {
      parts.push(tokens[j].value.toUpperCase());
      j++;
    }
    if (
      j < tokens.length &&
      tokens[j].type === "keyword" &&
      tokens[j].value.toUpperCase() === "OUTER"
    ) {
      parts.push("OUTER");
      j++;
    }
    if (
      j < tokens.length &&
      tokens[j].type === "keyword" &&
      tokens[j].value.toUpperCase() === "JOIN"
    ) {
      parts.push("JOIN");
      return parts.join(" ");
    }
    return null;
  }

  if (upper === "CROSS") {
    if (
      idx + 1 < tokens.length &&
      tokens[idx + 1].type === "keyword" &&
      tokens[idx + 1].value.toUpperCase() === "JOIN"
    ) {
      return "CROSS JOIN";
    }
    return null;
  }

  if (["INNER", "LEFT", "RIGHT", "FULL"].includes(upper)) {
    let j = idx + 1;
    const parts = [upper];
    if (
      j < tokens.length &&
      tokens[j].type === "keyword" &&
      tokens[j].value.toUpperCase() === "OUTER"
    ) {
      parts.push("OUTER");
      j++;
    }
    if (
      j < tokens.length &&
      tokens[j].type === "keyword" &&
      tokens[j].value.toUpperCase() === "JOIN"
    ) {
      parts.push("JOIN");
      return parts.join(" ");
    }
    return null;
  }

  return null;
}

function countJoinKeywords(joinType: string): number {
  return joinType.split(" ").length;
}

export function splitIntoClauses(tokens: Token[]): RawClause[] {
  if (tokens.length === 0) {
    throw new SqlParseError("Empty SQL statement", 0);
  }

  // Strip trailing semicolons
  while (
    tokens.length > 0 &&
    tokens[tokens.length - 1].type === "punctuation" &&
    tokens[tokens.length - 1].value === ";"
  ) {
    tokens = tokens.slice(0, -1);
  }

  if (tokens.length === 0) {
    throw new SqlParseError("Empty SQL statement", 0);
  }

  // Check first keyword
  const firstKeyword = tokens[0];
  if (firstKeyword.type === "keyword") {
    const upper = firstKeyword.value.toUpperCase();
    if (REJECTED_STATEMENTS.has(upper)) {
      throw new SqlParseError(
        `${upper} statements are not supported, only SELECT`,
        firstKeyword.position,
      );
    }
    if (upper !== "SELECT") {
      throw new SqlParseError(
        `Expected SELECT, got ${upper}`,
        firstKeyword.position,
      );
    }
  } else {
    throw new SqlParseError("Expected SELECT keyword", firstKeyword.position);
  }

  const clauses: RawClause[] = [];
  let currentType = "SELECT";
  let currentStart = 1; // skip the SELECT keyword
  let currentPosition = firstKeyword.position;
  let parenDepth = 0;
  let caseDepth = 0;

  function pushClause(endIdx: number) {
    clauses.push({
      type: currentType,
      tokens: tokens.slice(currentStart, endIdx),
      position: currentPosition,
    });
  }

  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];

    if (t.type === "punctuation") {
      if (t.value === "(") parenDepth++;
      if (t.value === ")") parenDepth--;
      if (parenDepth < 0) {
        throw new SqlParseError("Unbalanced parentheses", t.position);
      }
      continue;
    }

    // Only consider clause boundaries at depth 0
    if (parenDepth > 0) continue;

    if (t.type === "keyword") {
      const upper = t.value.toUpperCase();

      // Track CASE depth
      if (upper === "CASE") {
        caseDepth++;
        continue;
      }
      if (upper === "END") {
        if (caseDepth > 0) {
          caseDepth--;
          continue;
        }
      }

      // Inside a CASE expression, don't split on keywords
      if (caseDepth > 0) continue;

      // Check for set operations
      if (SET_OPERATIONS.has(upper)) {
        throw new SqlParseError(`${upper} is not supported`, t.position);
      }

      // Check for rejected statements appearing mid-query
      if (REJECTED_STATEMENTS.has(upper)) {
        throw new SqlParseError(
          `${upper} statements are not supported`,
          t.position,
        );
      }

      // Clause boundaries
      if (upper === "SELECT") {
        // Nested SELECT at depth 0 shouldn't happen (subqueries are inside parens)
        throw new SqlParseError(
          "Unexpected SELECT — subqueries must be wrapped in parentheses",
          t.position,
        );
      }

      if (upper === "FROM") {
        pushClause(i);
        currentType = "FROM";
        currentStart = i + 1;
        currentPosition = t.position;
        continue;
      }

      if (upper === "WHERE") {
        pushClause(i);
        currentType = "WHERE";
        currentStart = i + 1;
        currentPosition = t.position;
        continue;
      }

      if (upper === "HAVING") {
        pushClause(i);
        currentType = "HAVING";
        currentStart = i + 1;
        currentPosition = t.position;
        continue;
      }

      if (upper === "LIMIT") {
        pushClause(i);
        currentType = "LIMIT";
        currentStart = i + 1;
        currentPosition = t.position;
        continue;
      }

      if (upper === "OFFSET") {
        pushClause(i);
        currentType = "OFFSET";
        currentStart = i + 1;
        currentPosition = t.position;
        continue;
      }

      if (upper === "GROUP" && i + 1 < tokens.length) {
        const next = tokens[i + 1];
        if (next.type === "keyword" && next.value.toUpperCase() === "BY") {
          pushClause(i);
          currentType = "GROUP BY";
          currentStart = i + 2;
          currentPosition = t.position;
          i++; // skip BY
          continue;
        }
      }

      if (upper === "ORDER" && i + 1 < tokens.length) {
        const next = tokens[i + 1];
        if (next.type === "keyword" && next.value.toUpperCase() === "BY") {
          pushClause(i);
          currentType = "ORDER BY";
          currentStart = i + 2;
          currentPosition = t.position;
          i++; // skip BY
          continue;
        }
      }

      if (upper === "FETCH" && i + 1 < tokens.length) {
        const next = tokens[i + 1];
        if (
          next.type === "keyword" &&
          (next.value.toUpperCase() === "FIRST" ||
            next.value.toUpperCase() === "NEXT")
        ) {
          pushClause(i);
          currentType = "FETCH";
          currentStart = i + 1; // include FIRST/NEXT in the clause tokens
          currentPosition = t.position;
          continue;
        }
      }

      // JOIN detection
      if (JOIN_STARTERS.has(upper)) {
        const joinType = isJoinStart(tokens, i);
        if (joinType) {
          pushClause(i);
          const skip = countJoinKeywords(joinType);
          currentType = "JOIN:" + joinType;
          currentStart = i + skip;
          currentPosition = t.position;
          i += skip - 1; // -1 because loop increments
          continue;
        }
      }
    }
  }

  // Push the last clause
  pushClause(tokens.length);

  // Validate parens balanced
  if (parenDepth !== 0) {
    throw new SqlParseError(
      "Unbalanced parentheses",
      tokens[tokens.length - 1].position,
    );
  }

  // Validate we have a SELECT clause
  if (!clauses.some((c) => c.type === "SELECT")) {
    throw new SqlParseError("No SELECT clause found", 0);
  }

  return clauses;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function tokensToString(tokens: Token[]): string {
  let result = "";
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (i > 0) {
      const prev = tokens[i - 1];
      // Don't add space around dots (for qualified names like u.id, schema.table)
      if (
        (t.type === "punctuation" && t.value === ".") ||
        (prev.type === "punctuation" && prev.value === ".")
      ) {
        // no space
      } else {
        result += " ";
      }
    }
    result += t.raw;
  }
  return result;
}

/** Split tokens by comma at paren depth 0, returning groups of tokens */
function splitByComma(tokens: Token[]): Token[][] {
  const groups: Token[][] = [];
  let current: Token[] = [];
  let depth = 0;

  for (const t of tokens) {
    if (t.type === "punctuation" && t.value === "(") depth++;
    if (t.type === "punctuation" && t.value === ")") depth--;
    if (depth === 0 && t.type === "punctuation" && t.value === ",") {
      if (current.length > 0) groups.push(current);
      current = [];
    } else {
      current.push(t);
    }
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

/**
 * Reconstruct a table reference from tokens, handling dotted names and subqueries.
 * Returns [tableString, alias, remainingTokens].
 */
function parseTableRef(tokens: Token[]): {
  table: string;
  alias: string | null;
  rest: Token[];
} {
  if (tokens.length === 0) {
    return { table: "", alias: null, rest: [] };
  }

  let i = 0;

  // Check for subquery: starts with (
  if (tokens[0].type === "punctuation" && tokens[0].value === "(") {
    let depth = 0;
    const start = i;
    while (i < tokens.length) {
      if (tokens[i].type === "punctuation" && tokens[i].value === "(") depth++;
      if (tokens[i].type === "punctuation" && tokens[i].value === ")") depth--;
      if (depth === 0) {
        i++;
        break;
      }
      i++;
    }
    const table = tokensToString(tokens.slice(start, i));
    const rest = tokens.slice(i);
    const aliasInfo = extractAlias(rest);
    return { table, alias: aliasInfo.alias, rest: aliasInfo.rest };
  }

  // Regular table name (possibly dotted: schema.table or project.dataset.table)
  const nameParts: string[] = [];
  if (
    tokens[i].type === "identifier" ||
    tokens[i].type === "keyword" ||
    tokens[i].type === "quoted_identifier"
  ) {
    nameParts.push(tokens[i].raw);
    i++;

    while (
      i + 1 < tokens.length &&
      tokens[i].type === "punctuation" &&
      tokens[i].value === "." &&
      (tokens[i + 1].type === "identifier" ||
        tokens[i + 1].type === "keyword" ||
        tokens[i + 1].type === "quoted_identifier" ||
        tokens[i + 1].value === "*")
    ) {
      nameParts.push(".");
      nameParts.push(tokens[i + 1].raw);
      i += 2;
    }
  }

  const table = nameParts.join("");
  const rest = tokens.slice(i);
  const aliasInfo = extractAlias(rest);
  return { table, alias: aliasInfo.alias, rest: aliasInfo.rest };
}

function extractAlias(tokens: Token[]): {
  alias: string | null;
  rest: Token[];
} {
  if (tokens.length === 0) return { alias: null, rest: [] };

  let i = 0;
  // Explicit AS alias
  if (tokens[i].type === "keyword" && tokens[i].value.toUpperCase() === "AS") {
    i++;
    if (i < tokens.length) {
      const alias = tokens[i].raw;
      return { alias, rest: tokens.slice(i + 1) };
    }
    return { alias: null, rest: tokens.slice(i) };
  }

  // Implicit alias: next token is an identifier or quoted identifier
  // that isn't a keyword that starts a clause
  if (
    tokens[i].type === "identifier" ||
    tokens[i].type === "quoted_identifier"
  ) {
    const alias = tokens[i].raw;
    return { alias, rest: tokens.slice(i + 1) };
  }

  return { alias: null, rest: tokens };
}

// ─── Phase 3: Clause Parsers ─────────────────────────────────────────────────

function parseSelectClause(clause: RawClause): {
  items: SelectItem[];
  distinct: boolean;
} {
  let tokens = clause.tokens;
  let distinct = false;

  // Check for DISTINCT
  if (
    tokens.length > 0 &&
    tokens[0].type === "keyword" &&
    tokens[0].value.toUpperCase() === "DISTINCT"
  ) {
    distinct = true;
    tokens = tokens.slice(1);
  }

  // Check for ALL
  if (
    tokens.length > 0 &&
    tokens[0].type === "keyword" &&
    tokens[0].value.toUpperCase() === "ALL"
  ) {
    tokens = tokens.slice(1);
  }

  const groups = splitByComma(tokens);
  const items: SelectItem[] = [];

  for (const group of groups) {
    if (group.length === 0) continue;

    // Check for explicit AS alias: ... AS alias
    const asIdx = findLastAs(group);
    if (asIdx >= 0 && asIdx + 1 < group.length) {
      const exprTokens = group.slice(0, asIdx);
      const aliasToken = group[asIdx + 1];
      items.push({
        expr: tokensToString(exprTokens),
        alias: aliasToken.raw,
      });
      continue;
    }

    // Check for implicit alias:
    // The last token is an identifier (not star, not a keyword unless it's clearly an alias)
    // and the second-to-last token is a closing paren, identifier, keyword (END), number, string, or quoted_identifier
    // but NOT a dot, operator, or clause-like keyword
    if (group.length >= 2) {
      const last = group[group.length - 1];
      const secondLast = group[group.length - 2];

      const isImplicitAlias =
        (last.type === "identifier" || last.type === "quoted_identifier") &&
        // After closing paren: COUNT(*) cnt
        ((secondLast.type === "punctuation" && secondLast.value === ")") ||
          // After identifier: col1 c1
          secondLast.type === "identifier" ||
          secondLast.type === "quoted_identifier" ||
          // After number: unlikely but ok
          secondLast.type === "number" ||
          // After string
          secondLast.type === "string" ||
          // After END keyword (CASE...END alias)
          (secondLast.type === "keyword" &&
            secondLast.value.toUpperCase() === "END"));

      if (isImplicitAlias) {
        const exprTokens = group.slice(0, group.length - 1);
        items.push({
          expr: tokensToString(exprTokens),
          alias: last.raw,
        });
        continue;
      }
    }

    // No alias
    items.push({
      expr: tokensToString(group),
      alias: null,
    });
  }

  return { items, distinct };
}

/** Find the last AS keyword at paren depth 0 */
function findLastAs(tokens: Token[]): number {
  let depth = 0;
  let lastAs = -1;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type === "punctuation" && tokens[i].value === "(") depth++;
    if (tokens[i].type === "punctuation" && tokens[i].value === ")") depth--;
    if (
      depth === 0 &&
      tokens[i].type === "keyword" &&
      tokens[i].value.toUpperCase() === "AS"
    ) {
      lastAs = i;
    }
  }
  return lastAs;
}

function parseFromClause(clause: RawClause): {
  from: FromClause | null;
  implicitJoins: FromClause[];
} {
  if (clause.tokens.length === 0) {
    return { from: null, implicitJoins: [] };
  }

  const groups = splitByComma(clause.tokens);
  const tables: FromClause[] = [];

  for (const group of groups) {
    const ref = parseTableRef(group);
    tables.push({ table: ref.table, alias: ref.alias });
  }

  if (tables.length === 0) {
    return { from: null, implicitJoins: [] };
  }

  return {
    from: tables[0],
    implicitJoins: tables.slice(1),
  };
}

function parseJoinClause(clause: RawClause, joinType: string): JoinClause {
  const tokens = clause.tokens;

  // Find ON or USING at depth 0
  let onIdx = -1;
  let usingIdx = -1;
  let depth = 0;

  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type === "punctuation" && tokens[i].value === "(") depth++;
    if (tokens[i].type === "punctuation" && tokens[i].value === ")") depth--;
    if (depth === 0 && tokens[i].type === "keyword") {
      const upper = tokens[i].value.toUpperCase();
      if (upper === "ON" && onIdx === -1) {
        onIdx = i;
        break;
      }
      if (upper === "USING" && usingIdx === -1) {
        usingIdx = i;
        break;
      }
    }
  }

  let tableTokens: Token[];
  let on: string | null = null;
  let usingCols: string[] | null = null;

  if (onIdx >= 0) {
    tableTokens = tokens.slice(0, onIdx);
    on = tokensToString(tokens.slice(onIdx + 1));
  } else if (usingIdx >= 0) {
    tableTokens = tokens.slice(0, usingIdx);
    // USING (col1, col2, ...)
    const usingTokens = tokens.slice(usingIdx + 1);
    usingCols = [];
    for (const t of usingTokens) {
      if (
        t.type === "identifier" ||
        t.type === "quoted_identifier" ||
        t.type === "keyword"
      ) {
        usingCols.push(t.raw);
      }
    }
  } else {
    tableTokens = tokens;
  }

  const ref = parseTableRef(tableTokens);

  return {
    joinType,
    table: ref.table,
    alias: ref.alias,
    on,
    using: usingCols,
  };
}

function parseWhereClause(clause: RawClause): string {
  return tokensToString(clause.tokens);
}

function parseGroupByClause(clause: RawClause): string[] {
  const groups = splitByComma(clause.tokens);
  return groups.map((g) => tokensToString(g));
}

function parseHavingClause(clause: RawClause): string {
  return tokensToString(clause.tokens);
}

function parseOrderByClause(clause: RawClause): OrderByItem[] {
  const groups = splitByComma(clause.tokens);
  const items: OrderByItem[] = [];

  for (const group of groups) {
    if (group.length === 0) continue;

    let exprEnd = group.length;
    let direction: "ASC" | "DESC" | null = null;
    let nulls: "FIRST" | "LAST" | null = null;

    // Check for NULLS FIRST/LAST at the end
    if (exprEnd >= 2) {
      const last = group[exprEnd - 1];
      const secondLast = group[exprEnd - 2];
      if (
        secondLast.type === "keyword" &&
        secondLast.value.toUpperCase() === "NULLS" &&
        last.type === "keyword" &&
        (last.value.toUpperCase() === "FIRST" ||
          last.value.toUpperCase() === "LAST")
      ) {
        nulls = last.value.toUpperCase() as "FIRST" | "LAST";
        exprEnd -= 2;
      }
    }

    // Check for ASC/DESC
    if (exprEnd >= 1) {
      const last = group[exprEnd - 1];
      if (
        last.type === "keyword" &&
        (last.value.toUpperCase() === "ASC" ||
          last.value.toUpperCase() === "DESC")
      ) {
        direction = last.value.toUpperCase() as "ASC" | "DESC";
        exprEnd -= 1;
      }
    }

    const expr = tokensToString(group.slice(0, exprEnd));
    items.push({ expr, direction, nulls });
  }

  return items;
}

function parseLimitClause(clause: RawClause): {
  limit: string | null;
  offset: string | null;
} {
  const tokens = clause.tokens;
  const text = tokensToString(tokens);

  // Check for MySQL LIMIT offset, count syntax
  // Detect comma at depth 0
  let depth = 0;
  let commaIdx = -1;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type === "punctuation" && tokens[i].value === "(") depth++;
    if (tokens[i].type === "punctuation" && tokens[i].value === ")") depth--;
    if (
      depth === 0 &&
      tokens[i].type === "punctuation" &&
      tokens[i].value === ","
    ) {
      commaIdx = i;
      break;
    }
  }

  if (commaIdx >= 0) {
    // MySQL syntax: LIMIT offset, count
    const offsetPart = tokensToString(tokens.slice(0, commaIdx));
    const countPart = tokensToString(tokens.slice(commaIdx + 1));
    return { limit: countPart, offset: offsetPart };
  }

  return { limit: text || null, offset: null };
}

function parseFetchClause(clause: RawClause): { limit: string } {
  // FETCH FIRST|NEXT n ROWS ONLY
  // clause.tokens starts from FIRST/NEXT
  const tokens = clause.tokens;
  // Skip FIRST/NEXT
  let i = 0;
  if (
    i < tokens.length &&
    tokens[i].type === "keyword" &&
    (tokens[i].value.toUpperCase() === "FIRST" ||
      tokens[i].value.toUpperCase() === "NEXT")
  ) {
    i++;
  }

  // Collect until ROW/ROWS or ONLY
  const valueParts: string[] = [];
  while (i < tokens.length) {
    const upper = tokens[i].value.toUpperCase();
    if (
      tokens[i].type === "keyword" &&
      (upper === "ROW" || upper === "ROWS" || upper === "ONLY")
    ) {
      break;
    }
    valueParts.push(tokens[i].raw);
    i++;
  }

  return { limit: valueParts.join(" ") || "1" };
}

// ─── Multi-statement check ───────────────────────────────────────────────────

function checkMultipleStatements(tokens: Token[]): void {
  let depth = 0;
  let afterSemicolon = false;

  for (const t of tokens) {
    if (t.type === "punctuation" && t.value === "(") depth++;
    if (t.type === "punctuation" && t.value === ")") depth--;
    if (depth === 0 && t.type === "punctuation" && t.value === ";") {
      afterSemicolon = true;
    } else if (afterSemicolon) {
      throw new SqlParseError(
        "Multiple statements are not supported",
        t.position,
      );
    }
  }
}

// ─── CTE Parser ──────────────────────────────────────────────────────────────

function parseCtes(tokens: Token[]): { ctes: CteClause[]; rest: Token[] } {
  const ctes: CteClause[] = [];
  let i = 0;

  // Skip WITH
  i++;

  // Skip optional RECURSIVE
  if (
    i < tokens.length &&
    tokens[i].type === "keyword" &&
    tokens[i].value.toUpperCase() === "RECURSIVE"
  ) {
    i++;
  }

  while (i < tokens.length) {
    // Read CTE name
    if (
      i >= tokens.length ||
      (tokens[i].type !== "identifier" &&
        tokens[i].type !== "quoted_identifier" &&
        tokens[i].type !== "keyword")
    ) {
      throw new SqlParseError(
        "Expected CTE name after WITH",
        tokens[i]?.position ?? 0,
      );
    }
    const name = tokens[i].raw;
    i++;

    // Optional column list: name (col1, col2) AS (...)
    let columns: string[] | null = null;
    if (
      i < tokens.length &&
      tokens[i].type === "punctuation" &&
      tokens[i].value === "("
    ) {
      // Look ahead: find matching ) then check if next token is AS
      let depth = 0;
      let j = i;
      while (j < tokens.length) {
        if (tokens[j].type === "punctuation" && tokens[j].value === "(")
          depth++;
        if (tokens[j].type === "punctuation" && tokens[j].value === ")")
          depth--;
        if (depth === 0) break;
        j++;
      }
      // j is at the closing )
      if (
        j + 1 < tokens.length &&
        tokens[j + 1].type === "keyword" &&
        tokens[j + 1].value.toUpperCase() === "AS"
      ) {
        // This is a column list
        columns = [];
        i++; // skip (
        while (
          i < tokens.length &&
          !(tokens[i].type === "punctuation" && tokens[i].value === ")")
        ) {
          if (
            tokens[i].type === "identifier" ||
            tokens[i].type === "quoted_identifier" ||
            tokens[i].type === "keyword"
          ) {
            columns.push(tokens[i].raw);
          }
          i++;
        }
        i++; // skip )
      }
    }

    // Expect AS
    if (
      i >= tokens.length ||
      tokens[i].type !== "keyword" ||
      tokens[i].value.toUpperCase() !== "AS"
    ) {
      throw new SqlParseError(
        "Expected AS in CTE definition",
        tokens[i]?.position ?? 0,
      );
    }
    i++;

    // Expect ( and read body until matching )
    if (
      i >= tokens.length ||
      tokens[i].type !== "punctuation" ||
      tokens[i].value !== "("
    ) {
      throw new SqlParseError(
        "Expected ( after AS in CTE definition",
        tokens[i]?.position ?? 0,
      );
    }
    i++; // skip opening (
    let depth = 1;
    const bodyStart = i;
    while (i < tokens.length && depth > 0) {
      if (tokens[i].type === "punctuation" && tokens[i].value === "(") depth++;
      if (tokens[i].type === "punctuation" && tokens[i].value === ")") depth--;
      if (depth > 0) i++;
    }
    if (depth !== 0) {
      throw new SqlParseError(
        "Unbalanced parentheses in CTE body",
        tokens[bodyStart]?.position ?? 0,
      );
    }
    const body = tokensToString(tokens.slice(bodyStart, i));
    i++; // skip closing )

    ctes.push({ name, columns, body });

    // Check for comma (more CTEs) or done
    if (
      i < tokens.length &&
      tokens[i].type === "punctuation" &&
      tokens[i].value === ","
    ) {
      i++;
      continue;
    }
    break;
  }

  return { ctes, rest: tokens.slice(i) };
}

// ─── Main Parser ─────────────────────────────────────────────────────────────

export function parseSelect(sql: string): ParsedSelect {
  const trimmed = sql.trim();
  if (!trimmed) {
    throw new SqlParseError("Empty SQL statement", 0);
  }

  const tokens = tokenize(trimmed);

  // Check for multiple statements
  checkMultipleStatements(tokens);

  // Parse CTEs if present
  let ctes: CteClause[] = [];
  let selectTokens = tokens;
  if (
    tokens.length > 0 &&
    tokens[0].type === "keyword" &&
    tokens[0].value.toUpperCase() === "WITH"
  ) {
    const parsed = parseCtes(tokens);
    ctes = parsed.ctes;
    selectTokens = parsed.rest;
  }

  const clauses = splitIntoClauses(selectTokens);

  const result: ParsedSelect = {
    ctes,
    select: [],
    distinct: false,
    from: null,
    joins: [],
    where: null,
    groupBy: [],
    having: null,
    orderBy: [],
    limit: null,
    offset: null,
  };

  for (const clause of clauses) {
    if (clause.type === "SELECT") {
      const parsed = parseSelectClause(clause);
      result.select = parsed.items;
      result.distinct = parsed.distinct;
    } else if (clause.type === "FROM") {
      const parsed = parseFromClause(clause);
      result.from = parsed.from;
      // Add implicit joins from comma-separated tables
      for (const ij of parsed.implicitJoins) {
        result.joins.push({
          joinType: "CROSS JOIN",
          table: ij.table,
          alias: ij.alias,
          on: null,
          using: null,
        });
      }
    } else if (clause.type.startsWith("JOIN:")) {
      const joinType = clause.type.slice(5);
      result.joins.push(parseJoinClause(clause, joinType));
    } else if (clause.type === "WHERE") {
      result.where = parseWhereClause(clause);
    } else if (clause.type === "GROUP BY") {
      result.groupBy = parseGroupByClause(clause);
    } else if (clause.type === "HAVING") {
      result.having = parseHavingClause(clause);
    } else if (clause.type === "ORDER BY") {
      result.orderBy = parseOrderByClause(clause);
    } else if (clause.type === "LIMIT") {
      const parsed = parseLimitClause(clause);
      result.limit = parsed.limit;
      if (parsed.offset !== null) {
        result.offset = parsed.offset;
      }
    } else if (clause.type === "OFFSET") {
      result.offset = tokensToString(clause.tokens) || null;
    } else if (clause.type === "FETCH") {
      const parsed = parseFetchClause(clause);
      result.limit = parsed.limit;
    }
  }

  return result;
}

// ─── WHERE → RowFilter parsing ───────────────────────────────────────────────

function splitByAnd(tokens: Token[]): Token[][] {
  const groups: Token[][] = [];
  let current: Token[] = [];
  let depth = 0;
  let afterBetween = false;

  for (const t of tokens) {
    if (t.type === "punctuation" && t.value === "(") depth++;
    if (t.type === "punctuation" && t.value === ")") depth--;

    if (
      depth === 0 &&
      t.type === "keyword" &&
      t.value.toUpperCase() === "BETWEEN"
    ) {
      afterBetween = true;
      current.push(t);
      continue;
    }

    if (
      depth === 0 &&
      t.type === "keyword" &&
      t.value.toUpperCase() === "AND"
    ) {
      if (afterBetween) {
        // This AND is part of BETWEEN...AND, keep it in current conjunct
        afterBetween = false;
        current.push(t);
      } else {
        if (current.length > 0) groups.push(current);
        current = [];
      }
    } else {
      current.push(t);
    }
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

function extractColumnFromTokens(
  tokens: Token[],
): { column: string; rest: Token[] } | null {
  if (tokens.length === 0) return null;
  const first = tokens[0];
  if (
    first.type !== "identifier" &&
    first.type !== "quoted_identifier" &&
    first.type !== "keyword"
  )
    return null;

  let i = 0;
  const parts: string[] = [first.value];
  i++;

  while (
    i + 1 < tokens.length &&
    tokens[i].type === "punctuation" &&
    tokens[i].value === "." &&
    (tokens[i + 1].type === "identifier" ||
      tokens[i + 1].type === "quoted_identifier" ||
      tokens[i + 1].type === "keyword")
  ) {
    parts.push(tokens[i + 1].value);
    i += 2;
  }

  return { column: parts.join("."), rest: tokens.slice(i) };
}

function extractStringValuesFromParens(tokens: Token[]): string[] | null {
  if (
    tokens.length < 3 ||
    tokens[0].type !== "punctuation" ||
    tokens[0].value !== "("
  )
    return null;

  const values: string[] = [];
  let i = 1;
  while (i < tokens.length) {
    if (tokens[i].type === "punctuation" && tokens[i].value === ")") {
      return values;
    }
    if (tokens[i].type === "string" || tokens[i].type === "number") {
      values.push(tokens[i].value);
      i++;
      if (
        i < tokens.length &&
        tokens[i].type === "punctuation" &&
        tokens[i].value === ","
      ) {
        i++;
      }
    } else if (tokens[i].type === "punctuation" && tokens[i].value === ",") {
      i++;
    } else {
      return null;
    }
  }
  return null; // no closing paren
}

function parseSingleCondition(tokens: Token[]): RowFilter | null {
  const colResult = extractColumnFromTokens(tokens);
  if (!colResult) return null;

  const { column, rest } = colResult;
  if (rest.length === 0) return null;

  const first = rest[0];

  // IS NULL / IS NOT NULL / IS TRUE / IS FALSE
  if (first.type === "keyword" && first.value.toUpperCase() === "IS") {
    if (rest.length === 2 && rest[1].type === "keyword") {
      const kw = rest[1].value.toUpperCase();
      if (kw === "NULL") return { operator: "is_null", column };
      if (kw === "TRUE") return { operator: "is_true", column };
      if (kw === "FALSE") return { operator: "is_false", column };
    }
    if (
      rest.length === 3 &&
      rest[1].type === "keyword" &&
      rest[1].value.toUpperCase() === "NOT" &&
      rest[2].type === "keyword" &&
      rest[2].value.toUpperCase() === "NULL"
    ) {
      return { operator: "not_null", column };
    }
    return null;
  }

  // NOT IN / NOT LIKE
  if (first.type === "keyword" && first.value.toUpperCase() === "NOT") {
    if (rest.length >= 2 && rest[1].type === "keyword") {
      const kw = rest[1].value.toUpperCase();
      if (kw === "IN") {
        const values = extractStringValuesFromParens(rest.slice(2));
        if (values) return { operator: "not_in", column, values };
      }
      if (kw === "LIKE" && rest.length === 3 && rest[2].type === "string") {
        const pattern = rest[2].value;
        if (pattern.startsWith("%") && pattern.endsWith("%")) {
          return {
            operator: "not_contains",
            column,
            values: [pattern.slice(1, -1)],
          };
        }
      }
    }
    return null;
  }

  // IN
  if (first.type === "keyword" && first.value.toUpperCase() === "IN") {
    const values = extractStringValuesFromParens(rest.slice(1));
    if (values) return { operator: "in", column, values };
    return null;
  }

  // LIKE
  if (first.type === "keyword" && first.value.toUpperCase() === "LIKE") {
    if (rest.length === 2 && rest[1].type === "string") {
      const pattern = rest[1].value;
      if (pattern.startsWith("%") && pattern.endsWith("%")) {
        return {
          operator: "contains",
          column,
          values: [pattern.slice(1, -1)],
        };
      }
      if (pattern.endsWith("%")) {
        return {
          operator: "starts_with",
          column,
          values: [pattern.slice(0, -1)],
        };
      }
      if (pattern.startsWith("%")) {
        return {
          operator: "ends_with",
          column,
          values: [pattern.slice(1)],
        };
      }
    }
    return null;
  }

  // Simple comparison: =, !=, <>, <, <=, >, >=
  if (first.type === "operator") {
    let op = first.value;
    if (op === "<>") op = "!=";
    if (["=", "!=", "<", "<=", ">", ">="].includes(op) && rest.length === 2) {
      if (rest[1].type === "string" || rest[1].type === "number") {
        return {
          operator: op as RowFilter["operator"],
          column,
          values: [rest[1].value],
        };
      }
      if (rest[1].type === "keyword") {
        const upper = rest[1].value.toUpperCase();
        if (upper === "TRUE" || upper === "FALSE") {
          return {
            operator: op as RowFilter["operator"],
            column,
            values: [upper.toLowerCase()],
          };
        }
      }
    }
    return null;
  }

  return null;
}

/**
 * Parse a SQL WHERE clause string into structured RowFilter objects.
 * Falls back to a single `sql_expr` filter for complex/unparseable expressions.
 */
export function parseWhereToRowFilters(where: string): RowFilter[] {
  try {
    const tokens = tokenize(where);

    // If OR exists at depth 0, fall back to sql_expr
    let depth = 0;
    for (const t of tokens) {
      if (t.type === "punctuation" && t.value === "(") depth++;
      if (t.type === "punctuation" && t.value === ")") depth--;
      if (
        depth === 0 &&
        t.type === "keyword" &&
        t.value.toUpperCase() === "OR"
      ) {
        return [{ operator: "sql_expr", values: [where] }];
      }
    }

    const conjuncts = splitByAnd(tokens);
    const filters: RowFilter[] = [];

    for (const conj of conjuncts) {
      const filter = parseSingleCondition(conj);
      if (!filter) {
        return [{ operator: "sql_expr", values: [where] }];
      }
      filters.push(filter);
    }

    return filters.length > 0
      ? filters
      : [{ operator: "sql_expr", values: [where] }];
  } catch {
    return [{ operator: "sql_expr", values: [where] }];
  }
}
