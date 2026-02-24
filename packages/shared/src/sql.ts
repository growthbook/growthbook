import { format as sqlFormat } from "sql-formatter";
import { SqlResultChunkInterface } from "../types/query";
import { FormatDialect } from "../types/sql";
import { FormatError } from "../types/error";

export const SQL_ROW_LIMIT = 1000;

export const MAX_SQL_LENGTH_TO_FORMAT = parseInt(
  process.env.MAX_SQL_LENGTH_TO_FORMAT || "15000",
);

/** Polyglot has higher limit (fast); rely on try/catch for WASM memory on very long SQL */
const MAX_SQL_LENGTH_FOR_POLYGLOT = parseInt(
  process.env.MAX_SQL_LENGTH_FOR_POLYGLOT || "500000",
);

// Lazy-load polyglot (ESM) so we can use it from CJS. Loaded asynchronously on first import.
let polyglotModule: Awaited<typeof import("@polyglot-sql/sdk")> | null = null;
void import("@polyglot-sql/sdk")
  .then((mod) => {
    polyglotModule = mod;
  })
  .catch(() => {
    /* Polyglot unavailable; will fall back to sql-formatter */
  });

function getPolyglotDialect(
  mod: Awaited<typeof import("@polyglot-sql/sdk")>,
  dialect: string,
): import("@polyglot-sql/sdk").Dialect {
  switch (dialect) {
    case "mysql":
      return mod.Dialect.MySQL;
    case "bigquery":
      return mod.Dialect.BigQuery;
    case "snowflake":
      return mod.Dialect.Snowflake;
    case "redshift":
      return mod.Dialect.Redshift;
    case "presto":
      return mod.Dialect.Presto;
    case "trino":
      return mod.Dialect.Trino;
    case "clickhouse":
      return mod.Dialect.ClickHouse;
    case "databricks":
      return mod.Dialect.Databricks;
    case "athena":
      return mod.Dialect.Athena;
    case "tsql":
      return mod.Dialect.TSQL;
    case "sqlite":
      return mod.Dialect.SQLite;
    case "sql":
      return mod.Dialect.PostgreSQL; // generic
    case "postgresql":
    default:
      return mod.Dialect.PostgreSQL;
  }
}

export function format(
  sql: string,
  dialect?: FormatDialect,
  onError?: (error: FormatError) => void,
): string {
  if (!dialect) return sql;

  // 1. Try polyglot first (high length limit; fast; may throw on WASM memory for very long SQL)
  if (
    MAX_SQL_LENGTH_FOR_POLYGLOT &&
    sql.length <= MAX_SQL_LENGTH_FOR_POLYGLOT
  ) {
    const mod = polyglotModule;
    if (mod) {
      try {
        const pgDialect = getPolyglotDialect(mod, dialect as string);
        const result = mod.format(sql, pgDialect);
        if (result?.success && result?.sql?.length) {
          return result.sql[0];
        }
      } catch {
        // WASM memory or parse error; fall through to sql-formatter
      }
    }
  }

  // 2. Fall back to sql-formatter (slower; skip for very large queries)
  if (MAX_SQL_LENGTH_TO_FORMAT && sql.length > MAX_SQL_LENGTH_TO_FORMAT) {
    return sql;
  }
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
