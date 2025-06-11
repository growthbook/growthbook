import { format as sqlFormat } from "sql-formatter";
import { FormatDialect, FormatError } from "./types";

export function format(
  sql: string,
  dialect?: FormatDialect,
  onError?: (error: FormatError) => void
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

  // Remove all comments from the SQL
  // This will break if comments are within strings
  // but that should not happen very often in practice
  sql = sql.replace(/(--[^\n\r]*)|(\/\*[\w\W]*?(?=\*\/)\*\/)/gm, "");

  // Remove trailing semicolons and spaces
  sql = sql.replace(/;\s*$/, "").trim();

  // Case 1: Has both LIMIT and OFFSET clauses
  const limitOffsetMatch = sql.match(/LIMIT\s+(\d+)\s+OFFSET\s+(\d+)$/);
  if (limitOffsetMatch) {
    const currentLimit = parseInt(limitOffsetMatch[1], 10);
    if (!isNaN(currentLimit) && currentLimit <= limit) {
      return sql;
    }
    return sql.replace(
      /LIMIT\s+\d+\s+OFFSET\s+(\d+)$/,
      `LIMIT ${limit} OFFSET $1`
    );
  }
  // Case 2: Has OFFSET clause only (BigQuery is the only one that supports this)
  if (/OFFSET\s+\d+$/.test(sql)) {
    return sql.replace(/OFFSET\s+(\d+)$/, `LIMIT ${limit} OFFSET $1`);
  }
  // Case 3: LIMIT clause only, but with 2 numbers (MySQL only)
  const limitTwoNumbersMatch = sql.match(/LIMIT\s+(\d+)\s*,\s*(\d+)$/);
  if (limitTwoNumbersMatch) {
    const currentLimit = parseInt(limitTwoNumbersMatch[2], 10);
    if (!isNaN(currentLimit) && currentLimit <= limit) {
      return sql;
    }
    return sql.replace(/LIMIT\s+(\d+)\s*,\s*\d+$/, `LIMIT $1, ${limit}`);
  }
  // Case 4: Normal LIMIT clause only
  const limitMatch = sql.match(/LIMIT\s+(\d+)$/);
  if (limitMatch) {
    const currentLimit = parseInt(limitMatch[1], 10);
    if (!isNaN(currentLimit) && currentLimit <= limit) {
      return sql;
    }

    return sql.replace(/LIMIT\s+\d+$/, `LIMIT ${limit}`);
  }
  // Default: Append LIMIT at the end
  return `${sql} LIMIT ${limit}`;
}
