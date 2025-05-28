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
