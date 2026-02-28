/**
 * Snowflake SQL Dialect
 *
 * Implements Snowflake-specific SQL generation methods including:
 * - TO_VARCHAR for casting/formatting
 * - HyperLogLog (HLL_ACCUMULATE, HLL_COMBINE, HLL_ESTIMATE)
 * - PARSE_JSON for JSON extraction
 * - Snowflake data types (VARCHAR, DOUBLE, etc.)
 */

import { DataType } from "shared/types/integrations";
import { FullSqlDialect } from "./index";
import { baseDialect } from "./base-dialect";

/**
 * Snowflake dialect implementation.
 *
 * Extracted from Snowflake.ts to enable:
 * - Unit testing of SQL generation without Snowflake client
 * - Reuse in SQL builders without class instantiation
 * - Clear separation of concerns
 */
export const snowflakeDialect: FullSqlDialect = {
  ...baseDialect,

  formatDialect: "snowflake",

  // ============================================================
  // Date/Time Functions (Snowflake-specific)
  // ============================================================

  formatDate(col: string): string {
    return `TO_VARCHAR(${col}, 'YYYY-MM-DD')`;
  },

  formatDateTimeString(col: string): string {
    return `TO_VARCHAR(${col}, 'YYYY-MM-DD HH24:MI:SS.MS')`;
  },

  // ============================================================
  // Type Casting (Snowflake-specific)
  // ============================================================

  castToString(col: string): string {
    return `TO_VARCHAR(${col})`;
  },

  ensureFloat(col: string): string {
    return `CAST(${col} AS DOUBLE)`;
  },

  // ============================================================
  // JSON Functions (Snowflake-specific)
  // ============================================================

  extractJSONField(jsonCol: string, path: string, isNumeric: boolean): string {
    const floatType = "float";
    const stringType = "string";
    return `PARSE_JSON(${jsonCol}):${path}::${isNumeric ? floatType : stringType}`;
  },

  // ============================================================
  // Data Types (Snowflake-specific)
  // ============================================================

  getDataType(dataType: DataType): string {
    switch (dataType) {
      case "string":
        return "VARCHAR";
      case "integer":
        return "INTEGER";
      case "float":
        return "DOUBLE";
      case "boolean":
        return "BOOLEAN";
      case "date":
        return "DATE";
      case "timestamp":
        return "TIMESTAMP";
      case "hll":
        return "BINARY";
      default: {
        const _: never = dataType;
        throw new Error(`Unsupported data type: ${dataType}`);
      }
    }
  },

  // ============================================================
  // HyperLogLog (Snowflake HLL_*)
  // ============================================================

  hasCountDistinctHLL(): boolean {
    return true;
  },

  hllAggregate(col: string): string {
    return `HLL_ACCUMULATE(${col})`;
  },

  hllReaggregate(col: string): string {
    return `HLL_COMBINE(${col})`;
  },

  hllCardinality(col: string): string {
    return `HLL_ESTIMATE(${col})`;
  },

  castToHllDataType(col: string): string {
    return `CAST(${col} AS BINARY)`;
  },

  // ============================================================
  // Quantile (Snowflake uses standard APPROX_PERCENTILE)
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
