import { format as sqlFormat } from "sql-formatter";
import { SqlResultChunkInterface } from "../types/query";
import { FormatDialect } from "../types/sql";
import { FormatError } from "../types/error";

export const SQL_ROW_LIMIT = 1000;

export const MAX_SQL_LENGTH_TO_FORMAT = parseInt(
  process.env.MAX_SQL_LENGTH_TO_FORMAT || "15000",
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

export function ensureLimit(sql: string, limit: number): string {
  if (limit <= 0) throw new Error("Limit must be a positive integer");

  // Remove trailing semicolons and spaces
  sql = sql.replace(/;\s*$/, "").trim();

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

export function isReadOnlySQL(sql: string) {
  const { strippedSql } = stripCommentsAndStrings(sql);

  // Check the first keyword (e.g. "select", "with", etc.)
  return !!strippedSql.match(/^\s*(with|select|explain|show|describe|desc)\b/i);
}

export function isMultiStatementSQL(sql: string) {
  const { strippedSql, parseError } = stripCommentsAndStrings(sql);

  // If there was a parse error, search the original string for semicolons
  if (parseError) {
    // Ignore final trailing semicolon when searching to avoid common false positive
    return sql.replace(/;\s*$/, "").includes(";");
  }
  // Otherwise, search the stripped SQL for semicolons
  else {
    return strippedSql.includes(";");
  }
}

function stripCommentsAndStrings(sql: string): {
  strippedSql: string;
  parseError: boolean;
} {
  let state:
    | "singleQuote"
    | "doubleQuote"
    | "backtickQuote"
    | "lineComment"
    | "blockComment"
    | null = null;

  const n = sql.length;

  let strippedSql = "";

  for (let i = 0; i < n; i++) {
    const char = sql[i];
    const nextChar = i + 1 < n ? sql[i + 1] : null;

    if (state === "singleQuote") {
      if (char === "\\") {
        // Skip escaped character (e.g. \' or \\)
        i++;
      } else if (char === "'") {
        strippedSql += char;
        state = null;
      }
    } else if (state === "doubleQuote") {
      if (char === "\\") {
        // Skip escaped character (e.g. \" or \\)
        i++;
      } else if (char === '"') {
        strippedSql += char;
        state = null;
      }
    } else if (state === "backtickQuote") {
      if (char === "`") {
        strippedSql += char;
        state = null;
      }
    } else if (state === "lineComment") {
      if (char === "\n" || char === "\r") {
        state = null; // End of line comment
      }
    } else if (state === "blockComment") {
      if (char === "*" && nextChar === "/") {
        state = null; // End of block comment
        i++; // Skip the '/'
      }
    } else {
      // Not in any special state
      if (char === "'") {
        strippedSql += char;
        state = "singleQuote";
      } else if (char === '"') {
        strippedSql += char;
        state = "doubleQuote";
      } else if (char === "`") {
        strippedSql += char;
        state = "backtickQuote";
      } else if (char === "-" && nextChar === "-") {
        state = "lineComment";
        i++; // Skip the second '-'
      } else if (char === "/" && nextChar === "*") {
        state = "blockComment";
        i++; // Skip the '*'
      } else {
        strippedSql += char;
      }
    }
  }

  // Removing trailing semicolon and spaces
  strippedSql = strippedSql.replace(/;\s*$/, "").trim();

  // See if we ended in an invalid state
  let parseError = false;
  if (
    state === "singleQuote" ||
    state === "doubleQuote" ||
    state === "backtickQuote" ||
    state === "blockComment"
  ) {
    parseError = true;
  }

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

  const columns = Object.keys(results[0]);
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
      const value = row[col];
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
