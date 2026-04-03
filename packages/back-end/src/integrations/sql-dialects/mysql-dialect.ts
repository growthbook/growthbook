/**
 * MySQL SQL Dialect
 *
 * Implements MySQL-specific SQL generation methods including:
 * - DATE_ADD/DATE_SUB for adding time
 * - DATE() for date truncation
 * - DATE_FORMAT for formatting
 * - DATEDIFF with reversed order
 * - JSON_EXTRACT for JSON extraction
 * - No HLL support
 * - Limited percentile support
 */

import { FullSqlDialect } from "./index";
import { baseDialect } from "./base-dialect";

/**
 * MySQL dialect implementation.
 *
 * Extracted from Mysql.ts to enable:
 * - Unit testing of SQL generation without MySQL client
 * - Reuse in SQL builders without class instantiation
 * - Clear separation of concerns
 */
export const mysqlDialect: FullSqlDialect = {
  ...baseDialect,

  formatDialect: "mysql",

  // ============================================================
  // Date/Time Functions (MySQL-specific)
  // ============================================================

  addTime(
    col: string,
    unit: "hour" | "minute",
    sign: "+" | "-",
    amount: number
  ): string {
    return `DATE_${sign === "+" ? "ADD" : "SUB"}(${col}, INTERVAL ${amount} ${unit.toUpperCase()})`;
  },

  dateTrunc(col: string): string {
    return `DATE(${col})`;
  },

  dateDiff(startCol: string, endCol: string): string {
    // MySQL DATEDIFF takes (end, start), returns end - start
    return `DATEDIFF(${endCol}, ${startCol})`;
  },

  formatDate(col: string): string {
    return `DATE_FORMAT(${col}, "%Y-%m-%d")`;
  },

  formatDateTimeString(col: string): string {
    return `DATE_FORMAT(${col}, "%Y-%m-%d %H:%i:%S")`;
  },

  // ============================================================
  // Type Casting (MySQL-specific)
  // ============================================================

  castToString(col: string): string {
    return `cast(${col} as char)`;
  },

  ensureFloat(col: string): string {
    return `CAST(${col} AS DOUBLE)`;
  },

  // ============================================================
  // JSON Functions (MySQL-specific)
  // ============================================================

  extractJSONField(jsonCol: string, path: string, isNumeric: boolean): string {
    const raw = `JSON_EXTRACT(${jsonCol}, '$.${path}')`;
    return isNumeric ? `CAST(${raw} AS DOUBLE)` : raw;
  },

  // ============================================================
  // HyperLogLog (MySQL does not support HLL)
  // ============================================================

  hasCountDistinctHLL(): boolean {
    return false;
  },

  hllAggregate(_col: string): string {
    throw new Error("MySQL does not support HyperLogLog");
  },

  hllReaggregate(_col: string): string {
    throw new Error("MySQL does not support HyperLogLog");
  },

  hllCardinality(_col: string): string {
    throw new Error("MySQL does not support HyperLogLog");
  },

  castToHllDataType(_col: string): string {
    throw new Error("MySQL does not support HyperLogLog");
  },

  // ============================================================
  // Quantile (MySQL has limited support)
  // ============================================================

  hasEfficientPercentile(): boolean {
    return false;
  },

  hasQuantileTesting(): boolean {
    return false;
  },

  approxQuantile(_value: string, _quantile: string | number): string {
    // MySQL doesn't have a built-in percentile function
    // The actual implementation in Mysql.ts uses a complex workaround
    throw new Error(
      "MySQL does not have a built-in approximate percentile function"
    );
  },
};
