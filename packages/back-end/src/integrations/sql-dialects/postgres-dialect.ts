/**
 * PostgreSQL SQL Dialect
 *
 * Implements PostgreSQL-specific SQL generation methods including:
 * - to_char for date formatting
 * - :: cast syntax
 * - JSON_EXTRACT_PATH_TEXT for JSON extraction
 * - PERCENTILE_CONT for quantiles (no approx)
 */

import { FullSqlDialect } from "./index";
import { baseDialect } from "./base-dialect";

/**
 * PostgreSQL dialect implementation.
 *
 * Extracted from Postgres.ts to enable:
 * - Unit testing of SQL generation without Postgres client
 * - Reuse in SQL builders without class instantiation
 * - Clear separation of concerns
 */
export const postgresDialect: FullSqlDialect = {
  ...baseDialect,

  formatDialect: "postgresql",

  // ============================================================
  // Date/Time Functions (PostgreSQL-specific)
  // ============================================================

  dateDiff(startCol: string, endCol: string): string {
    // Postgres doesn't have a DATEDIFF function, use subtraction
    return `${endCol}::DATE - ${startCol}::DATE`;
  },

  formatDate(col: string): string {
    return `to_char(${col}, 'YYYY-MM-DD')`;
  },

  formatDateTimeString(col: string): string {
    return `to_char(${col}, 'YYYY-MM-DD HH24:MI:SS.MS')`;
  },

  // ============================================================
  // Type Casting (PostgreSQL-specific)
  // ============================================================

  ensureFloat(col: string): string {
    return `${col}::float`;
  },

  // ============================================================
  // JSON Functions (PostgreSQL-specific)
  // ============================================================

  extractJSONField(jsonCol: string, path: string, isNumeric: boolean): string {
    // Split path by '.' and wrap each part in quotes
    const pathParts = path
      .split(".")
      .map((p) => `'${p}'`)
      .join(", ");
    const raw = `JSON_EXTRACT_PATH_TEXT(${jsonCol}::json, ${pathParts})`;
    return isNumeric ? `${raw}::float` : raw;
  },

  // ============================================================
  // HyperLogLog (PostgreSQL does not have native HLL)
  // ============================================================

  hasCountDistinctHLL(): boolean {
    return false;
  },

  hllAggregate(_col: string): string {
    throw new Error("PostgreSQL does not support HyperLogLog natively");
  },

  hllReaggregate(_col: string): string {
    throw new Error("PostgreSQL does not support HyperLogLog natively");
  },

  hllCardinality(_col: string): string {
    throw new Error("PostgreSQL does not support HyperLogLog natively");
  },

  castToHllDataType(_col: string): string {
    throw new Error("PostgreSQL does not support HyperLogLog natively");
  },

  // ============================================================
  // Quantile (PostgreSQL PERCENTILE_CONT - no approx)
  // ============================================================

  hasEfficientPercentile(): boolean {
    return true;
  },

  hasQuantileTesting(): boolean {
    return true;
  },

  approxQuantile(value: string, quantile: string | number): string {
    // PostgreSQL doesn't have approx quantile, use exact
    return `PERCENTILE_CONT(${quantile}) WITHIN GROUP (ORDER BY ${value})`;
  },
};
