import { format as sqlFormat, FormatOptions } from "sql-formatter";

// SQL formatter dialect type that automatically stays in sync with sql-formatter
export type FormatDialect = FormatOptions["language"] | "";

export function format(sql: string, dialect?: FormatDialect) {
  if (!dialect) return sql;

  try {
    return sqlFormat(sql, {
      language: dialect,
    });
  } catch (e) {
    return sql;
  }
}
