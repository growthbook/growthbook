/**
 * Databricks SQL Dialect
 *
 * Implements Databricks-specific SQL generation methods including:
 * - TIMESTAMP'...' for timestamp literals
 * - timestampadd for adding time
 * - date_format for formatting
 * - HyperLogLog (HLL_SKETCH_AGG, HLL_UNION_AGG, HLL_SKETCH_ESTIMATE)
 * - JSON extraction with :path:: syntax
 */

import { DataType } from "shared/types/integrations";
import { FullSqlDialect } from "./index";
import { baseDialect } from "./base-dialect";

/**
 * Databricks dialect implementation.
 *
 * Extracted from Databricks.ts to enable:
 * - Unit testing of SQL generation without Databricks client
 * - Reuse in SQL builders without class instantiation
 * - Clear separation of concerns
 */
export const databricksDialect: FullSqlDialect = {
  ...baseDialect,

  // sql-formatter doesn't support databricks explicitly yet
  formatDialect: "sql",

  // ============================================================
  // Date/Time Functions (Databricks-specific)
  // ============================================================

  toTimestamp(date: Date): string {
    return `TIMESTAMP'${date.toISOString()}'`;
  },

  addTime(
    col: string,
    unit: "hour" | "minute",
    sign: "+" | "-",
    amount: number
  ): string {
    return `timestampadd(${unit},${sign === "-" ? "-" : ""}${amount},${col})`;
  },

  formatDate(col: string): string {
    return `date_format(${col}, 'y-MM-dd')`;
  },

  formatDateTimeString(col: string): string {
    return `date_format(${col}, 'y-MM-dd HH:mm:ss.SSS')`;
  },

  // ============================================================
  // Type Casting (Databricks-specific)
  // ============================================================

  castToString(col: string): string {
    return `cast(${col} as string)`;
  },

  ensureFloat(col: string): string {
    return `cast(${col} as double)`;
  },

  // ============================================================
  // String Functions (Databricks-specific)
  // ============================================================

  escapeStringLiteral(value: string): string {
    // Databricks uses backslash escaping like BigQuery
    return value.replace(/(['\\])/g, "\\$1");
  },

  // ============================================================
  // JSON Functions (Databricks-specific)
  // ============================================================

  extractJSONField(jsonCol: string, path: string, isNumeric: boolean): string {
    const raw = `${jsonCol}:${path}`;
    return isNumeric ? `cast(${raw} as double)` : raw;
  },

  // ============================================================
  // Data Types (Databricks-specific)
  // ============================================================

  getDataType(dataType: DataType): string {
    switch (dataType) {
      case "string":
        return "STRING";
      case "integer":
        return "INT";
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
  // HyperLogLog (Databricks HLL_SKETCH_*)
  // ============================================================

  hasCountDistinctHLL(): boolean {
    return true;
  },

  hllAggregate(col: string): string {
    // Databricks requires string input for HLL_SKETCH_AGG
    return `HLL_SKETCH_AGG(cast(${col} as string))`;
  },

  hllReaggregate(col: string): string {
    return `HLL_UNION_AGG(${col})`;
  },

  hllCardinality(col: string): string {
    return `HLL_SKETCH_ESTIMATE(${col})`;
  },

  castToHllDataType(col: string): string {
    return `CAST(${col} AS BINARY)`;
  },

  // ============================================================
  // Quantile (Databricks uses APPROX_PERCENTILE)
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
