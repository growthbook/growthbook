import {
  ensureLimit,
  format,
  SQL_ROW_LIMIT,
  getSqlStringRules,
} from "shared/sql";
import { SqlDialect } from "shared/types/sql";

export function getFreeFormQuery(
  dialect: SqlDialect,
  sql: string,
  limit?: number,
): string {
  const limitedQuery = ensureLimit(
    sql,
    limit ?? SQL_ROW_LIMIT,
    getSqlStringRules(dialect),
  );
  return format(limitedQuery, dialect.formatDialect);
}
