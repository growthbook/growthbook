/**
 * Amazon Athena SQL Dialect
 *
 * Implements Athena-specific SQL generation methods including:
 * - from_iso8601_timestamp for timestamp parsing
 * - to_iso8601 for date formatting
 * - date_diff for date differences
 * - HyperLogLog (APPROX_SET, MERGE, CARDINALITY)
 */

import { FullSqlDialect } from "./index";
import { baseDialect } from "./base-dialect";

/**
 * Athena dialect implementation.
 *
 * Extracted from Athena.ts to enable:
 * - Unit testing of SQL generation without Athena client
 * - Reuse in SQL builders without class instantiation
 * - Clear separation of concerns
 *
 * Note: Athena uses Presto/Trino syntax.
 */
export const athenaDialect: FullSqlDialect = {
  ...baseDialect,

  formatDialect: "trino",

  // ============================================================
  // Date/Time Functions (Athena-specific)
  // ============================================================

  toTimestamp(date: Date): string {
    return `from_iso8601_timestamp('${date.toISOString()}')`;
  },

  addTime(
    col: string,
    unit: "hour" | "minute",
    sign: "+" | "-",
    amount: number
  ): string {
    return `${col} ${sign} INTERVAL '${amount}' ${unit}`;
  },

  dateDiff(startCol: string, endCol: string): string {
    return `date_diff('day', ${startCol}, ${endCol})`;
  },

  formatDate(col: string): string {
    return `substr(to_iso8601(${col}),1,10)`;
  },

  formatDateTimeString(col: string): string {
    return `to_iso8601(${col})`;
  },

  // ============================================================
  // Type Casting (Athena-specific)
  // ============================================================

  ensureFloat(col: string): string {
    return `CAST(${col} AS double)`;
  },

  // ============================================================
  // HyperLogLog (Athena/Presto APPROX_SET)
  // ============================================================

  hasCountDistinctHLL(): boolean {
    return true;
  },

  hllAggregate(col: string): string {
    return `APPROX_SET(${col})`;
  },

  hllReaggregate(col: string): string {
    return `MERGE(${col})`;
  },

  hllCardinality(col: string): string {
    return `CARDINALITY(${col})`;
  },

  castToHllDataType(col: string): string {
    return `CAST(${col} AS HyperLogLog)`;
  },

  // ============================================================
  // Quantile (Athena uses standard APPROX_PERCENTILE)
  // ============================================================

  hasEfficientPercentile(): boolean {
    return true;
  },

  hasQuantileTesting(): boolean {
    return true;
  },

  approxQuantile(value: string, quantile: string | number): string {
    return `APPROX_PERCENTILE(${value}, ${quantile})`;
  },
};
