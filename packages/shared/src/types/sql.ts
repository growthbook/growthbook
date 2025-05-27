import { format as sqlFormat, FormatOptions } from "sql-formatter";

// SQL formatter dialect type that automatically stays in sync with sql-formatter
export type FormatDialect = FormatOptions["language"] | "";

export interface FormatError {
  error: Error;
  originalSql: string;
}

export function format(
  sql: string,
  dialect?: FormatDialect,
  onError?: (error: FormatError) => void
) {
  if (!dialect) return sql;

  try {
    return sqlFormat(sql, {
      language: dialect,
    });
  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e));
    if (onError) {
      onError({ error, originalSql: sql });
    } else {
      return sql;
    }
  }
}
