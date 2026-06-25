import type { ApproxTopValuesParams, SqlDialect } from "shared/types/sql";

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
 * Snowflake `counters`, Databricks `maxItemsTracked`, and Trino/Presto/Athena
 * `capacity`; BigQuery's APPROX_TOP_COUNT and ClickHouse's topK take no such
 * argument.
 */
export function approxTopKCapacity(limit: number): number {
  return Math.min(100000, Math.max(limit * 10, 1000));
}

/**
 * Trino / Presto / Athena single-pass approximate top-k using
 * `approx_most_frequent(buckets, value, capacity)`, which returns a
 * `MAP(value, count)` per column. One aggregation row holds parallel arrays of
 * the column names and their maps; we expand both with UNNEST.
 */
export function approxMostFrequentTopValuesCTEBody(
  dialect: SqlDialect,
  {
    pairs,
    fromTable,
    whereClause,
    limit,
    maxValueLength,
  }: ApproxTopValuesParams,
): string {
  const capacity = approxTopKCapacity(limit);
  const names = pairs.map((p) => `'${p.keyLiteral}'`).join(", ");
  const maps = pairs
    .map(
      (p) =>
        `approx_most_frequent(${limit}, ${eligibleTopValueExpr(
          dialect,
          p.valueSql,
          maxValueLength,
        )}, ${capacity})`,
    )
    .join(",\n        ");

  return `
  SELECT __col.column_name AS column_name, __item.value AS value, __item.count AS count
  FROM (
    SELECT
      ARRAY[${names}] AS col_names,
      ARRAY[
        ${maps}
      ] AS col_maps
    FROM ${fromTable}
    WHERE ${whereClause}
  ) __agg
  CROSS JOIN UNNEST(__agg.col_names, __agg.col_maps) AS __col (column_name, items)
  CROSS JOIN UNNEST(__col.items) AS __item (value, count)
  WHERE __item.value IS NOT NULL`;
}
