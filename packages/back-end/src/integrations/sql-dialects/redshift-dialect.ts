/**
 * Amazon Redshift SQL Dialect
 *
 * Implements Redshift-specific SQL generation methods including:
 * - to_char for date formatting (like Postgres)
 * - :: cast syntax
 * - JSON_EXTRACT_PATH_TEXT for JSON extraction (with TRUE for null handling)
 * - HyperLogLog (HLL_CREATE_SKETCH, HLL_COMBINE, HLL_CARDINALITY)
 * - PERCENTILE_CONT for quantiles (no efficient approx)
 */

import { FullSqlDialect } from "./index";
import { baseDialect } from "./base-dialect";

/**
 * Redshift dialect implementation.
 *
 * Extracted from Redshift.ts to enable:
 * - Unit testing of SQL generation without Redshift client
 * - Reuse in SQL builders without class instantiation
 * - Clear separation of concerns
 *
 * Note: Redshift is similar to PostgreSQL but has some differences,
 * particularly around HLL support and JSON handling.
 */
export const redshiftDialect: FullSqlDialect = {
  ...baseDialect,

  formatDialect: "redshift",

  // ============================================================
  // Date/Time Functions (Redshift-specific, similar to Postgres)
  // ============================================================

  formatDate(col: string): string {
    return `to_char(${col}, 'YYYY-MM-DD')`;
  },

  formatDateTimeString(col: string): string {
    return `to_char(${col}, 'YYYY-MM-DD HH24:MI:SS.MS')`;
  },

  // ============================================================
  // Type Casting (Redshift-specific)
  // ============================================================

  ensureFloat(col: string): string {
    return `${col}::float`;
  },

  // ============================================================
  // JSON Functions (Redshift-specific)
  // ============================================================

  extractJSONField(jsonCol: string, path: string, isNumeric: boolean): string {
    // Redshift's JSON_EXTRACT_PATH_TEXT takes TRUE as final param for null handling
    const pathParts = path
      .split(".")
      .map((p) => `'${p}'`)
      .join(", ");
    const raw = `JSON_EXTRACT_PATH_TEXT(${jsonCol}, ${pathParts}, TRUE)`;
    return isNumeric ? `${raw}::float` : raw;
  },

  // ============================================================
  // HyperLogLog (Redshift HLL_*)
  // ============================================================

  hasCountDistinctHLL(): boolean {
    return true;
  },

  hllAggregate(col: string): string {
    return `HLL_CREATE_SKETCH(${col})`;
  },

  hllReaggregate(col: string): string {
    return `HLL_COMBINE(${col})`;
  },

  hllCardinality(col: string): string {
    return `HLL_CARDINALITY(${col})`;
  },

  castToHllDataType(col: string): string {
    return `CAST(${col} AS HLLSKETCH)`;
  },

  // ============================================================
  // Quantile (Redshift - no efficient approx percentile)
  // ============================================================

  hasEfficientPercentile(): boolean {
    // Redshift's approx behaves differently, so we mark as not efficient
    return false;
  },

  hasQuantileTesting(): boolean {
    return true;
  },

  approxQuantile(value: string, quantile: string | number): string {
    // Use exact percentile since approx behaves differently in Redshift
    return `PERCENTILE_CONT(${quantile}) WITHIN GROUP (ORDER BY ${value})`;
  },
};
