/**
 * ClickHouse SQL Dialect
 *
 * Implements ClickHouse-specific SQL generation methods including:
 * - toDateTime for timestamp creation
 * - dateAdd/dateSub for adding time
 * - dateTrunc/dateDiff with lowercase names
 * - formatDateTime for date formatting
 * - if() function instead of CASE WHEN
 * - HyperLogLog (uniqState, uniqMergeState, finalizeAggregation)
 * - quantile() for approximate percentiles
 * - JSON extraction with JSONExtract functions
 */

import { FullSqlDialect } from "./index";
import { baseDialect } from "./base-dialect";

/**
 * ClickHouse dialect implementation.
 *
 * Extracted from ClickHouse.ts to enable:
 * - Unit testing of SQL generation without ClickHouse client
 * - Reuse in SQL builders without class instantiation
 * - Clear separation of concerns
 */
export const clickhouseDialect: FullSqlDialect = {
  ...baseDialect,

  // sql-formatter doesn't have a dedicated ClickHouse dialect
  formatDialect: "",

  // ============================================================
  // Date/Time Functions (ClickHouse-specific)
  // ============================================================

  toTimestamp(date: Date): string {
    return `toDateTime('${date.toISOString().substr(0, 19).replace("T", " ")}', 'UTC')`;
  },

  addTime(
    col: string,
    unit: "hour" | "minute",
    sign: "+" | "-",
    amount: number
  ): string {
    return `date${sign === "+" ? "Add" : "Sub"}(${unit}, ${amount}, ${col})`;
  },

  dateTrunc(col: string): string {
    return `dateTrunc('day', ${col})`;
  },

  dateDiff(startCol: string, endCol: string): string {
    return `dateDiff('day', ${startCol}, ${endCol})`;
  },

  formatDate(col: string): string {
    return `formatDateTime(${col}, '%F')`;
  },

  formatDateTimeString(col: string): string {
    return `formatDateTime(${col}, '%Y-%m-%d %H:%i:%S.%f')`;
  },

  // ============================================================
  // Type Casting (ClickHouse-specific)
  // ============================================================

  castToDate(col: string): string {
    const columType = col === "NULL" ? "Nullable(DATE)" : "DATE";
    return `CAST(${col} AS ${columType})`;
  },

  castToString(col: string): string {
    return `toString(${col})`;
  },

  ensureFloat(col: string): string {
    return `toFloat64(${col})`;
  },

  // ============================================================
  // Control Flow (ClickHouse-specific)
  // ============================================================

  ifElse(condition: string, ifTrue: string, ifFalse: string): string {
    return `if(${condition}, ${ifTrue}, ${ifFalse})`;
  },

  evalBoolean(col: string, value: boolean): string {
    // ClickHouse does not support `IS TRUE` / `IS FALSE`
    return `${col} = ${value ? "true" : "false"}`;
  },

  // ============================================================
  // JSON Functions (ClickHouse-specific)
  // ============================================================

  extractJSONField(jsonCol: string, path: string, isNumeric: boolean): string {
    if (isNumeric) {
      return `
if(
  toTypeName(${jsonCol}) = 'JSON',
  toFloat64(${jsonCol}.${path}),
  JSONExtractFloat(${jsonCol}, '${path}')
)
      `.trim();
    } else {
      return `
if(
  toTypeName(${jsonCol}) = 'JSON',
  ${jsonCol}.${path}.:String,
  JSONExtractString(${jsonCol}, '${path}')
)
      `.trim();
    }
  },

  // ============================================================
  // HyperLogLog (ClickHouse uniq*)
  // ============================================================

  hasCountDistinctHLL(): boolean {
    return true;
  },

  hllAggregate(col: string): string {
    return `uniqState(${col})`;
  },

  hllReaggregate(col: string): string {
    return `uniqMergeState(${col})`;
  },

  hllCardinality(col: string): string {
    return `finalizeAggregation(${col})`;
  },

  castToHllDataType(col: string): string {
    // ClickHouse uses AggregateFunction type, but for casting purposes BINARY works
    return `CAST(${col} AS String)`;
  },

  // ============================================================
  // Quantile (ClickHouse quantile)
  // ============================================================

  hasEfficientPercentile(): boolean {
    return true;
  },

  hasQuantileTesting(): boolean {
    return true;
  },

  approxQuantile(value: string, quantile: string | number): string {
    return `quantile(${quantile})(${value})`;
  },
};
