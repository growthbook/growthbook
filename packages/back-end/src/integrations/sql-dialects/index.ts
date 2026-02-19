/**
 * SQL Dialect Interface
 *
 * This module provides a dialect abstraction for SQL generation across different
 * database systems (BigQuery, Snowflake, Postgres, etc.). Each database has its
 * own syntax for dates, casting, aggregations, etc.
 *
 * The goal is to extract these dialect-specific methods from SqlIntegration.ts
 * into composable, testable units that can be used independently.
 */

import { FormatDialect } from "shared/types/sql";
import { DataType } from "shared/types/integrations";

/**
 * Core SQL dialect interface for database-specific SQL generation.
 *
 * All methods are pure functions that return SQL fragments. They do not
 * execute queries or have side effects.
 */
export interface SqlDialect {
  /**
   * The format dialect used by sql-formatter library.
   * E.g., "bigquery", "snowflake", "postgresql", "mysql", "trino", "tsql"
   */
  readonly formatDialect: FormatDialect;

  // ============================================================
  // Date/Time Functions
  // ============================================================

  /**
   * Convert a JavaScript Date to a SQL timestamp literal (without milliseconds).
   * @example toTimestamp(new Date('2023-01-15T12:30:45Z')) => "'2023-01-15 12:30:45'"
   */
  toTimestamp(date: Date): string;

  /**
   * Convert a JavaScript Date to a SQL timestamp literal (with milliseconds).
   * @example toTimestampWithMs(new Date('2023-01-15T12:30:45.123Z')) => "'2023-01-15 12:30:45.123'"
   */
  toTimestampWithMs(date: Date): string;

  /**
   * Add hours to a datetime column.
   * @example addHours('timestamp', 24) => "DATETIME_ADD(timestamp, INTERVAL 24 HOUR)"
   */
  addHours(col: string, hours: number): string;

  /**
   * Add time to a datetime column with specified unit and sign.
   * @example addTime('timestamp', 'hour', '+', 24) => "timestamp + INTERVAL '24 hours'"
   */
  addTime(
    col: string,
    unit: "hour" | "minute",
    sign: "+" | "-",
    amount: number
  ): string;

  /**
   * Truncate a timestamp/datetime to day granularity.
   * @example dateTrunc('timestamp') => "date_trunc('day', timestamp)"
   */
  dateTrunc(col: string): string;

  /**
   * Calculate the difference in days between two date columns.
   * @example dateDiff('start_date', 'end_date') => "datediff(day, start_date, end_date)"
   */
  dateDiff(startCol: string, endCol: string): string;

  /**
   * Format a date column as a string in YYYY-MM-DD format.
   * @example formatDate('date_col') => "format_date('%F', date_col)"
   */
  formatDate(col: string): string;

  /**
   * Format a datetime column as a string in YYYY-MM-DD HH:MI:SS format.
   * @example formatDateTimeString('datetime_col') => "format_datetime('%F %T', datetime_col)"
   */
  formatDateTimeString(col: string): string;

  // ============================================================
  // Type Casting
  // ============================================================

  /**
   * Cast a column to a string type.
   * @example castToString('numeric_col') => "cast(numeric_col as string)"
   */
  castToString(col: string): string;

  /**
   * Cast a column to a date type.
   * @example castToDate('string_col') => "CAST(string_col AS DATE)"
   */
  castToDate(col: string): string;

  /**
   * Cast a column to a timestamp type.
   * @example castToTimestamp('string_col') => "CAST(string_col AS TIMESTAMP)"
   */
  castToTimestamp(col: string): string;

  /**
   * Cast a user-provided date column (may need special handling).
   * BigQuery needs DATETIME, others may differ.
   * @example castUserDateCol('user_date') => "CAST(user_date as DATETIME)"
   */
  castUserDateCol(col: string): string;

  /**
   * Ensure a column is a float type (for arithmetic operations).
   * @example ensureFloat('int_col') => "int_col::float"
   */
  ensureFloat(col: string): string;

  // ============================================================
  // String Functions
  // ============================================================

  /**
   * Escape a string value for use in a SQL literal.
   * @example escapeStringLiteral("it's") => "it''s" or "it\'s"
   */
  escapeStringLiteral(value: string): string;

  // ============================================================
  // Control Flow
  // ============================================================

  /**
   * Generate a CASE WHEN expression.
   * @example ifElse('x > 0', '1', '0') => "(CASE WHEN x > 0 THEN 1 ELSE 0 END)"
   */
  ifElse(condition: string, ifTrue: string, ifFalse: string): string;

  /**
   * Generate a boolean evaluation expression.
   * @example evalBoolean('active', true) => "active IS TRUE"
   */
  evalBoolean(col: string, value: boolean): string;

  // ============================================================
  // Query Structure
  // ============================================================

  /**
   * Generate a SELECT * with LIMIT statement.
   * @example selectStarLimit('users', 10) => "SELECT * FROM users LIMIT 10"
   */
  selectStarLimit(table: string, limit: number): string;

  // ============================================================
  // JSON Functions
  // ============================================================

  /**
   * Extract a field from a JSON column.
   * @example extractJSONField('json_col', 'user.name', false) => "JSON_VALUE(json_col, '$.user.name')"
   */
  extractJSONField(jsonCol: string, path: string, isNumeric: boolean): string;

  // ============================================================
  // Data Types
  // ============================================================

  /**
   * Map a logical DataType to the database-specific SQL type name.
   * @example getDataType('string') => "STRING" (BigQuery) or "VARCHAR" (Snowflake)
   */
  getDataType(dataType: DataType): string;
}

/**
 * Extended dialect interface for databases that support HyperLogLog
 * (approximate count distinct).
 */
export interface HllDialect {
  /**
   * Check if HLL count distinct is supported.
   */
  hasCountDistinctHLL(): boolean;

  /**
   * Aggregate values into an HLL sketch.
   * @example hllAggregate('user_id') => "HLL_COUNT.INIT(user_id)"
   */
  hllAggregate(col: string): string;

  /**
   * Merge HLL sketches (for reaggregation).
   * @example hllReaggregate('hll_col') => "HLL_COUNT.MERGE_PARTIAL(hll_col)"
   */
  hllReaggregate(col: string): string;

  /**
   * Extract cardinality from an HLL sketch.
   * @example hllCardinality('hll_col') => "HLL_COUNT.EXTRACT(hll_col)"
   */
  hllCardinality(col: string): string;

  /**
   * Cast a column to the HLL data type.
   * @example castToHllDataType('col') => "CAST(col AS BYTES)"
   */
  castToHllDataType(col: string): string;
}

/**
 * Extended dialect interface for databases that support quantile/percentile functions.
 */
export interface QuantileDialect {
  /**
   * Check if the database has efficient percentile/quantile support.
   * Some databases (like MySQL) have limited support.
   */
  hasEfficientPercentile(): boolean;

  /**
   * Check if quantile testing is supported.
   */
  hasQuantileTesting(): boolean;

  /**
   * Generate an approximate quantile expression.
   * @example approxQuantile('value', 0.5) => "APPROX_QUANTILES(value, 10000)[OFFSET(5000)]"
   */
  approxQuantile(value: string, quantile: string | number): string;
}

/**
 * Full dialect interface combining core, HLL, and quantile capabilities.
 */
export interface FullSqlDialect extends SqlDialect, HllDialect, QuantileDialect {}

/**
 * Type guard to check if a dialect supports HLL operations.
 */
export function hasHllSupport(
  dialect: SqlDialect
): dialect is SqlDialect & HllDialect {
  const d = dialect as unknown as Partial<HllDialect>;
  return (
    typeof d.hasCountDistinctHLL === "function" &&
    typeof d.hllAggregate === "function" &&
    typeof d.hllReaggregate === "function" &&
    typeof d.hllCardinality === "function" &&
    d.hasCountDistinctHLL()
  );
}

/**
 * Type guard to check if a dialect supports quantile operations.
 */
export function hasQuantileSupport(
  dialect: SqlDialect
): dialect is SqlDialect & QuantileDialect {
  const d = dialect as unknown as Partial<QuantileDialect>;
  return (
    typeof d.approxQuantile === "function" &&
    typeof d.hasEfficientPercentile === "function" &&
    typeof d.hasQuantileTesting === "function"
  );
}

// Re-export implementations
export { baseDialect } from "./base-dialect";
export { bigQueryDialect } from "./bigquery-dialect";
export { snowflakeDialect } from "./snowflake-dialect";
export { postgresDialect } from "./postgres-dialect";
export { redshiftDialect } from "./redshift-dialect";
export { athenaDialect } from "./athena-dialect";
export { prestoDialect } from "./presto-dialect";
export { databricksDialect } from "./databricks-dialect";
export { clickhouseDialect } from "./clickhouse-dialect";
export { mysqlDialect } from "./mysql-dialect";
export { mssqlDialect } from "./mssql-dialect";
