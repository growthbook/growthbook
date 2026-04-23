import { ensureLimit, format, SQL_ROW_LIMIT } from "shared/sql";
import { SqlHelpers } from "shared/types/sql";

export function getFreeFormQuery(
  helpers: SqlHelpers,
  sql: string,
  limit?: number,
): string {
  const limitedQuery = ensureLimit(sql, limit ?? SQL_ROW_LIMIT);
  return format(limitedQuery, helpers.formatDialect);
}
