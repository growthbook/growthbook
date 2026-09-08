import { DataSourceType } from "shared/types/datasource";
import { parseIntWithDefault } from "./numbers";

// Datasources whose warehouse enforces a strict per-account concurrency limit
// default to a conservative number of concurrent queries when the user leaves
// the setting blank, rather than running unlimited.
const DEFAULT_MAX_CONCURRENT_QUERIES: Partial<Record<DataSourceType, number>> =
  {
    adobe_experience_platform_query_service: 1,
  };

// The concurrency limit applied when the user has not set one. 0 means no limit.
export function getDefaultMaxConcurrentQueries(type: DataSourceType): number {
  return DEFAULT_MAX_CONCURRENT_QUERIES[type] ?? 0;
}

// Resolves the concurrency limit enforced at query time from the stored setting.
// A blank or invalid setting falls back to the type's default; an explicit 0
// means no limit. 0 (from either source) means no limit.
export function getMaxConcurrentQueriesLimit(
  type: DataSourceType,
  maxConcurrentQueries: string | undefined,
): number {
  return parseIntWithDefault(
    maxConcurrentQueries,
    getDefaultMaxConcurrentQueries(type),
  );
}
