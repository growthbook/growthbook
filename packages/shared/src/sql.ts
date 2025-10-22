import { format as sqlFormat } from "sql-formatter";
import { FormatDialect, FormatError } from "./types";

export const SQL_ROW_LIMIT = 1000;

export function format(
  sql: string,
  dialect?: FormatDialect,
  onError?: (error: FormatError) => void,
): string {
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
  const normalized = stripSQLComments(sql).toLowerCase();

  // Check the first keyword (e.g. "select", "with", etc.)
  const match = normalized.match(
    /^\s*(with|select|explain|show|describe|desc)\b/,
  );
  if (!match) return false;

  return true;
}

export function isMultiStatementSQL(sql: string) {
  let state:
    | "singleQuote"
    | "doubleQuote"
    | "backtickQuote"
    | "lineComment"
    | "blockComment"
    | null = null;

  const n = sql.length;

  let foundSemicolon = false;

  for (let i = 0; i < n; i++) {
    const char = sql[i];
    const nextChar = i + 1 < n ? sql[i + 1] : null;

    if (state === "singleQuote") {
      if (char === "\\") {
        // Skip escaped character (e.g. \' or \\)
        i++;
      } else if (char === "'") {
        // Check for escaped single quote by doubling
        if (nextChar === "'") {
          i++; // Skip the escaped quote
        } else {
          state = null; // End of single quote
        }
      }
    } else if (state === "doubleQuote") {
      if (char === "\\") {
        // Skip escaped character (e.g. \" or \\)
        i++;
      } else if (char === '"') {
        // Check for escaped double quote by doubling
        if (nextChar === '"') {
          i++; // Skip the escaped quote
        } else {
          state = null; // End of double quote
        }
      }
    } else if (state === "backtickQuote") {
      if (char === "`") {
        // Ignore doubled backticks
        if (nextChar === "`") {
          i++; // Skip the escaped backtick
        } else {
          state = null; // End of backtick quote
        }
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
        state = "singleQuote";
      } else if (char === '"') {
        state = "doubleQuote";
      } else if (char === "`") {
        state = "backtickQuote";
      } else if (char === "-" && nextChar === "-") {
        state = "lineComment";
        i++; // Skip the second '-'
      } else if (char === "/" && nextChar === "*") {
        state = "blockComment";
        i++; // Skip the '*'
      } else if (char === ";") {
        foundSemicolon = true;
      } else {
        // Check for any non-whitespace character after a semicolon
        if (foundSemicolon && /\S/.test(char)) {
          return true;
        }
      }
    }
  }

  // If we finish in an invalid state, something went wrong. Be conservative by searching for a semicolon in the entire string
  if (
    state === "singleQuote" ||
    state === "doubleQuote" ||
    state === "backtickQuote" ||
    state === "blockComment"
  ) {
    // Ignore final trailing semicolon when searching to avoid common false positive
    return sql.replace(/\s*;\s*/, "").includes(";");
  }

  return false;
}

export function stripSQLComments(sql: string): string {
  return sql
    .trim()
    .replace(/\/\*[\s\S]*?\*\//g, "") // remove block comments
    .replace(/--.*$/gm, "") // remove line comments
    .replace(/\s*;\s*$/, ""); // trim trailing semicolon
}
