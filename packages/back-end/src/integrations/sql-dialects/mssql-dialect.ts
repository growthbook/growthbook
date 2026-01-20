/**
 * Microsoft SQL Server (MSSQL) SQL Dialect
 *
 * Implements MSSQL-specific SQL generation methods including:
 * - DATEADD for adding time
 * - cast(col as DATE) for date truncation (DATETRUNC is SQL Server 2022+)
 * - FORMAT for date formatting
 * - SELECT TOP instead of LIMIT
 * - CONVERT for datetime strings
 * - JSON_VALUE for JSON extraction
 * - Boolean comparison using = 1/0 instead of IS TRUE/FALSE
 * - No HLL support
 * - APPROX_PERCENTILE_CONT for quantiles
 */

import { FullSqlDialect } from "./index";
import { baseDialect } from "./base-dialect";

/**
 * MSSQL dialect implementation.
 *
 * Extracted from Mssql.ts to enable:
 * - Unit testing of SQL generation without MSSQL client
 * - Reuse in SQL builders without class instantiation
 * - Clear separation of concerns
 */
export const mssqlDialect: FullSqlDialect = {
  ...baseDialect,

  formatDialect: "tsql",

  // ============================================================
  // Date/Time Functions (MSSQL-specific)
  // ============================================================

  addTime(
    col: string,
    unit: "hour" | "minute",
    sign: "+" | "-",
    amount: number
  ): string {
    return `DATEADD(${unit}, ${sign === "-" ? "-" : ""}${amount}, ${col})`;
  },

  dateTrunc(col: string): string {
    // DATETRUNC is only supported in SQL Server 2022 preview
    return `cast(${col} as DATE)`;
  },

  formatDate(col: string): string {
    return `FORMAT(${col}, 'yyyy-MM-dd')`;
  },

  formatDateTimeString(col: string): string {
    // CONVERT with style 121 gives: yyyy-mm-dd hh:mi:ss.mmm
    return `CONVERT(VARCHAR(25), ${col}, 121)`;
  },

  // ============================================================
  // Type Casting (MSSQL-specific)
  // ============================================================

  castToString(col: string): string {
    return `cast(${col} as varchar(256))`;
  },

  ensureFloat(col: string): string {
    return `CAST(${col} as FLOAT)`;
  },

  // ============================================================
  // Query Structure (MSSQL-specific)
  // ============================================================

  selectStarLimit(table: string, limit: number): string {
    // MSSQL doesn't support LIMIT, uses TOP instead
    return `SELECT TOP ${limit} * FROM ${table}`;
  },

  // ============================================================
  // Control Flow (MSSQL-specific)
  // ============================================================

  evalBoolean(col: string, value: boolean): string {
    // MS SQL does not support `IS TRUE` / `IS FALSE`
    return `${col} = ${value ? "1" : "0"}`;
  },

  // ============================================================
  // JSON Functions (MSSQL-specific)
  // ============================================================

  extractJSONField(jsonCol: string, path: string, isNumeric: boolean): string {
    const raw = `JSON_VALUE(${jsonCol}, '$.${path}')`;
    return isNumeric ? `CAST(${raw} as FLOAT)` : raw;
  },

  // ============================================================
  // HyperLogLog (MSSQL does not support HLL)
  // ============================================================

  hasCountDistinctHLL(): boolean {
    return false;
  },

  hllAggregate(_col: string): string {
    throw new Error("MSSQL does not support HyperLogLog");
  },

  hllReaggregate(_col: string): string {
    throw new Error("MSSQL does not support HyperLogLog");
  },

  hllCardinality(_col: string): string {
    throw new Error("MSSQL does not support HyperLogLog");
  },

  castToHllDataType(_col: string): string {
    throw new Error("MSSQL does not support HyperLogLog");
  },

  // ============================================================
  // Quantile (MSSQL APPROX_PERCENTILE_CONT)
  // ============================================================

  hasEfficientPercentile(): boolean {
    return true;
  },

  hasQuantileTesting(): boolean {
    return true;
  },

  approxQuantile(value: string, quantile: string | number): string {
    return `APPROX_PERCENTILE_CONT(${quantile}) WITHIN GROUP (ORDER BY ${value})`;
  },
};
