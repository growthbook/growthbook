/**
 * BigQuery SQL Dialect
 *
 * Implements BigQuery-specific SQL generation methods including:
 * - DATETIME functions (DATETIME_ADD, DATETIME_SUB)
 * - HyperLogLog (HLL_COUNT.*)
 * - APPROX_QUANTILES
 * - BigQuery data types (STRING, INT64, FLOAT64, etc.)
 */

import { DataType } from "shared/types/integrations";
import { FullSqlDialect } from "./index";
import { baseDialect } from "./base-dialect";

/**
 * BigQuery dialect implementation.
 *
 * Extracted from BigQuery.ts to enable:
 * - Unit testing of SQL generation without BigQuery client
 * - Reuse in SQL builders without class instantiation
 * - Clear separation of concerns
 */
export const bigQueryDialect: FullSqlDialect = {
  ...baseDialect,

  formatDialect: "bigquery",

  // ============================================================
  // Date/Time Functions (BigQuery-specific)
  // ============================================================

  addTime(
    col: string,
    unit: "hour" | "minute",
    sign: "+" | "-",
    amount: number
  ): string {
    return `DATETIME_${
      sign === "+" ? "ADD" : "SUB"
    }(${col}, INTERVAL ${amount} ${unit.toUpperCase()})`;
  },

  dateTrunc(col: string): string {
    return `date_trunc(${col}, DAY)`;
  },

  dateDiff(startCol: string, endCol: string): string {
    return `date_diff(${endCol}, ${startCol}, DAY)`;
  },

  formatDate(col: string): string {
    return `format_date("%F", ${col})`;
  },

  formatDateTimeString(col: string): string {
    return `format_datetime("%F %T", ${col})`;
  },

  // ============================================================
  // Type Casting (BigQuery-specific)
  // ============================================================

  castToString(col: string): string {
    return `cast(${col} as string)`;
  },

  castUserDateCol(col: string): string {
    return `CAST(${col} as DATETIME)`;
  },

  // ============================================================
  // String Functions (BigQuery-specific)
  // ============================================================

  escapeStringLiteral(value: string): string {
    // BigQuery uses backslash escaping
    return value.replace(/(['\\])/g, "\\$1");
  },

  // ============================================================
  // JSON Functions (BigQuery-specific)
  // ============================================================

  extractJSONField(jsonCol: string, path: string, isNumeric: boolean): string {
    const raw = `JSON_VALUE(${jsonCol}, '$.${path}')`;
    return isNumeric ? `CAST(${raw} AS FLOAT64)` : raw;
  },

  // ============================================================
  // Data Types (BigQuery-specific)
  // ============================================================

  getDataType(dataType: DataType): string {
    switch (dataType) {
      case "string":
        return "STRING";
      case "integer":
        return "INT64";
      case "float":
        return "FLOAT64";
      case "boolean":
        return "BOOL";
      case "date":
        return "DATE";
      case "timestamp":
        return "TIMESTAMP";
      case "hll":
        return "BYTES";
      default: {
        const _: never = dataType;
        throw new Error(`Unsupported data type: ${dataType}`);
      }
    }
  },

  // ============================================================
  // HyperLogLog (BigQuery HLL_COUNT.*)
  // ============================================================

  hasCountDistinctHLL(): boolean {
    return true;
  },

  hllAggregate(col: string): string {
    return `HLL_COUNT.INIT(${col})`;
  },

  hllReaggregate(col: string): string {
    return `HLL_COUNT.MERGE_PARTIAL(${col})`;
  },

  hllCardinality(col: string): string {
    return `HLL_COUNT.EXTRACT(${col})`;
  },

  castToHllDataType(col: string): string {
    return `CAST(${col} AS BYTES)`;
  },

  // ============================================================
  // Quantile (BigQuery APPROX_QUANTILES)
  // ============================================================

  hasEfficientPercentile(): boolean {
    return true;
  },

  hasQuantileTesting(): boolean {
    return true;
  },

  approxQuantile(value: string, quantile: string | number): string {
    const multiplier = 10000;
    const quantileVal = Number(quantile)
      ? Math.trunc(multiplier * Number(quantile))
      : `${multiplier} * ${quantile}`;
    return `APPROX_QUANTILES(${value}, ${multiplier} IGNORE NULLS)[OFFSET(CAST(${quantileVal} AS INT64))]`;
  },
};
