import type { Dialect, format as polyglotFormat } from "@polyglot-sql/sdk";
import { format as sqlFormat } from "sql-formatter";
import { SqlResultChunkInterface } from "../types/query";
import { FormatDialect } from "../types/sql";
import { FormatError } from "../types/error";

/** Module shape from @polyglot-sql/sdk - used by loader. Types come from the package. */
export type PolyglotModule = {
  format: typeof polyglotFormat;
  Dialect: typeof Dialect;
};

export type FormatMetricsEvent =
  | { engine: "polyglot"; success: true; timeMs: number }
  | { engine: "polyglot"; success: false; timeMs: number }
  | { engine: "sqlformat"; success: true; timeMs: number }
  | { engine: "sqlformat"; success: false; timeMs: number };

let formatMetricsReporter: ((event: FormatMetricsEvent) => void) | null = null;

export function setFormatMetricsReporter(
  reporter: (event: FormatMetricsEvent) => void,
): void {
  formatMetricsReporter = reporter;
}

export const SQL_ROW_LIMIT = 1000;

export const MAX_SQL_LENGTH_TO_FORMAT = parseInt(
  process.env.MAX_SQL_LENGTH_TO_FORMAT || "15000",
);

const MAX_SQL_LENGTH_FOR_POLYGLOT = parseInt(
  process.env.MAX_SQL_LENGTH_FOR_POLYGLOT || "500000",
);

let polyglotLoader: (() => Promise<PolyglotModule>) | null = null;
let polyglotModuleCache: PolyglotModule | null = null;
let polyglotLoadPromise: Promise<PolyglotModule | null> | null = null;

/**
 * Set a loader for @polyglot-sql/sdk. Back-end uses new Function() to preserve native import in CJS;
 * front-end uses import() so Webpack creates an async chunk. Called by each host's init.
 */
export function setPolyglotLoader(loader: () => Promise<PolyglotModule>): void {
  polyglotLoader = loader;
}

function getPolyglotDialect(mod: PolyglotModule, dialect: string): Dialect {
  const { Dialect } = mod;
  switch (dialect) {
    case "mysql":
      return Dialect.MySQL;
    case "bigquery":
      return Dialect.BigQuery;
    case "snowflake":
      return Dialect.Snowflake;
    case "redshift":
      return Dialect.Redshift;
    case "presto":
      return Dialect.Presto;
    case "trino":
      return Dialect.Trino;
    case "clickhouse":
      return Dialect.ClickHouse;
    case "databricks":
      return Dialect.Databricks;
    case "athena":
      return Dialect.Athena;
    case "tsql":
      return Dialect.TSQL;
    case "sqlite":
      return Dialect.SQLite;
    case "sql":
      return Dialect.PostgreSQL;
    default:
      return Dialect.PostgreSQL;
  }
}

/** Start loading polyglot immediately (call when modal opens so first Format can use it) */
export function startPolyglotLoad(): void {
  if (!polyglotLoader || polyglotLoadPromise) return;
  polyglotLoadPromise = polyglotLoader()
    .then((mod) => {
      polyglotModuleCache = mod;
      return mod;
    })
    .catch(() => null);
}

export type FormatWithStatusResult = { sql: string; isFormatted: boolean };

/** Returns formatted SQL and whether polyglot or sql-formatter succeeded. */
export function formatWithStatus(
  sql: string,
  dialect?: FormatDialect,
  onError?: (error: FormatError) => void,
): FormatWithStatusResult {
  if (!dialect) return { sql, isFormatted: false };
  const report = formatMetricsReporter;

  // 1. Try polyglot first if loaded as it is faster and can handle longer SQL
  if (
    MAX_SQL_LENGTH_FOR_POLYGLOT &&
    sql.length <= MAX_SQL_LENGTH_FOR_POLYGLOT
  ) {
    // Polyglot should have been loaded by now, but just in case we do it again so on following calls it is ready
    startPolyglotLoad();
    const mod = polyglotModuleCache;
    if (mod) {
      const polyglotStart = performance.now();
      let result: string | null = null;
      try {
        const pgDialect = getPolyglotDialect(mod, dialect as string);
        const fmtResult = mod.format(sql, pgDialect);
        if (fmtResult?.success && fmtResult?.sql?.length)
          result = fmtResult.sql[0];
      } catch {
        /* fall through */
      }
      const timeMs = performance.now() - polyglotStart;
      if (result != null) {
        report?.({ engine: "polyglot", success: true, timeMs });
        return { sql: result, isFormatted: true };
      }
      report?.({ engine: "polyglot", success: false, timeMs });
      // Parse error; fall through to sql-formatter
    }
  }

  // 2. Fall back to sql-formatter but skip for very large queries
  if (MAX_SQL_LENGTH_TO_FORMAT && sql.length > MAX_SQL_LENGTH_TO_FORMAT) {
    return { sql, isFormatted: false };
  }
  const sqlFormatStart = performance.now();
  try {
    const formatted = sqlFormat(sql, {
      language: dialect,
    });
    report?.({
      engine: "sqlformat",
      success: true,
      timeMs: performance.now() - sqlFormatStart,
    });
    return { sql: formatted, isFormatted: true };
  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e));
    report?.({
      engine: "sqlformat",
      success: false,
      timeMs: performance.now() - sqlFormatStart,
    });
    if (onError) {
      onError({ error, originalSql: sql });
    }
    return { sql, isFormatted: false };
  }
}

export function format(
  sql: string,
  dialect?: FormatDialect,
  onError?: (error: FormatError) => void,
): string {
  return formatWithStatus(sql, dialect, onError).sql;
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
