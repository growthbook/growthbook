/**
 * Presto/Trino SQL Dialect
 *
 * Implements Presto-specific SQL generation methods including:
 * - from_iso8601_timestamp for timestamp parsing
 * - to_iso8601 for date formatting
 * - date_diff for date differences
 * - HyperLogLog (APPROX_SET, MERGE with HyperLogLog cast, CARDINALITY)
 *
 * Note: Very similar to Athena, but with slight differences in HLL handling.
 */

import { FullSqlDialect } from "./index";
import { baseDialect } from "./base-dialect";

/**
 * Presto/Trino dialect implementation.
 *
 * Extracted from Presto.ts to enable:
 * - Unit testing of SQL generation without Presto client
 * - Reuse in SQL builders without class instantiation
 * - Clear separation of concerns
 */
export const prestoDialect: FullSqlDialect = {
  ...baseDialect,

  formatDialect: "trino",

  // ============================================================
  // Date/Time Functions (Presto-specific)
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
  // Type Casting (Presto-specific)
  // ============================================================

  ensureFloat(col: string): string {
    return `CAST(${col} AS DOUBLE)`;
  },

  // ============================================================
  // HyperLogLog (Presto APPROX_SET with explicit HyperLogLog cast for merge)
  // ============================================================

  hasCountDistinctHLL(): boolean {
    return true;
  },

  hllAggregate(col: string): string {
    return `APPROX_SET(${col})`;
  },

  hllReaggregate(col: string): string {
    // Presto requires explicit cast to HyperLogLog for MERGE
    return `MERGE(CAST(${col} AS HyperLogLog))`;
  },

  hllCardinality(col: string): string {
    return `CARDINALITY(${col})`;
  },

  castToHllDataType(col: string): string {
    return `CAST(${col} AS HyperLogLog)`;
  },

  // ============================================================
  // Quantile (Presto uses APPROX_PERCENTILE)
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
