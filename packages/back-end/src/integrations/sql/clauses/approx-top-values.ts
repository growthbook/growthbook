import type { SqlDialect } from "shared/types/sql";

/**
 * Map NULL or over-length values to NULL so the approximate aggregates (which
 * ignore NULLs) exclude them, mirroring the exact path's
 * `value IS NOT NULL AND LENGTH(value) <= maxValueLength` filter. With no
 * `maxValueLength`, the expression is returned unchanged.
 */
export function eligibleTopValueExpr(
  dialect: SqlDialect,
  valueSql: string,
  maxValueLength?: number,
): string {
  if (maxValueLength === undefined) return valueSql;
  return dialect.ifElse(
    `${valueSql} IS NOT NULL AND ${dialect.stringLength(
      valueSql,
    )} <= ${maxValueLength}`,
    valueSql,
    "NULL",
  );
}

/**
 * Tracking capacity for the Space-Saving top-k family, sized well above `k` so
 * counts stay accurate for the low-cardinality columns this runs on. Maps to
 * Snowflake `counters`, Databricks `maxItemsTracked`, and Trino/Presto
 * `capacity`; BigQuery's APPROX_TOP_COUNT and ClickHouse's topK take no such
 * argument.
 */
export function approxTopKCapacity(limit: number): number {
  return Math.min(100000, Math.max(limit * 10, 1000));
}
