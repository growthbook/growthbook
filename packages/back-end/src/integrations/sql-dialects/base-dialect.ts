/**
 * Base SQL Dialect Implementation
 *
 * Provides default implementations for SQL generation methods.
 * These defaults match the original SqlIntegration.ts base class methods
 * and work with standard SQL syntax.
 *
 * Database-specific dialects should extend or override these methods.
 */

import { DataType } from "shared/types/integrations";
import { SqlDialect, QuantileDialect } from "./index";

/**
 * Base dialect with standard SQL implementations.
 * This matches the original SqlIntegration defaults.
 */
export const baseDialect: SqlDialect & Partial<QuantileDialect> = {
  formatDialect: "",

  // ============================================================
  // Date/Time Functions
  // ============================================================

  toTimestamp(date: Date): string {
    return `'${date.toISOString().substr(0, 19).replace("T", " ")}'`;
  },

  toTimestampWithMs(date: Date): string {
    return `'${date.toISOString().substring(0, 23).replace("T", " ")}'`;
  },

  addHours(col: string, hours: number): string {
    if (!hours) return col;

    let unit: "hour" | "minute" = "hour";
    const sign = hours > 0 ? "+" : "-";
    hours = Math.abs(hours);

    const roundedHours = Math.round(hours);
    const roundedMinutes = Math.round(hours * 60);

    let amount = roundedHours;

    // If minutes are needed, use them
    if (roundedMinutes % 60 > 0) {
      unit = "minute";
      amount = roundedMinutes;
    }

    if (amount === 0) {
      return col;
    }

    return this.addTime(col, unit, sign, amount);
  },

  addTime(
    col: string,
    unit: "hour" | "minute",
    sign: "+" | "-",
    amount: number
  ): string {
    return `${col} ${sign} INTERVAL '${amount} ${unit}s'`;
  },

  dateTrunc(col: string): string {
    return `date_trunc('day', ${col})`;
  },

  dateDiff(startCol: string, endCol: string): string {
    return `datediff(day, ${startCol}, ${endCol})`;
  },

  formatDate(col: string): string {
    return col;
  },

  formatDateTimeString(col: string): string {
    return this.castToString(col);
  },

  // ============================================================
  // Type Casting
  // ============================================================

  castToString(col: string): string {
    return `cast(${col} as varchar)`;
  },

  castToDate(col: string): string {
    return `CAST(${col} AS DATE)`;
  },

  castToTimestamp(col: string): string {
    return `CAST(${col} AS TIMESTAMP)`;
  },

  castUserDateCol(col: string): string {
    return col;
  },

  ensureFloat(col: string): string {
    return col;
  },

  // ============================================================
  // String Functions
  // ============================================================

  escapeStringLiteral(value: string): string {
    return value.replace(/'/g, `''`);
  },

  // ============================================================
  // Control Flow
  // ============================================================

  ifElse(condition: string, ifTrue: string, ifFalse: string): string {
    return `(CASE WHEN ${condition} THEN ${ifTrue} ELSE ${ifFalse} END)`;
  },

  evalBoolean(col: string, value: boolean): string {
    return `${col} IS ${value ? "TRUE" : "FALSE"}`;
  },

  // ============================================================
  // Query Structure
  // ============================================================

  selectStarLimit(table: string, limit: number): string {
    return `SELECT * FROM ${table} LIMIT ${limit}`;
  },

  // ============================================================
  // JSON Functions
  // ============================================================

  extractJSONField(jsonCol: string, path: string, isNumeric: boolean): string {
    const raw = `json_extract_scalar(${jsonCol}, '$.${path}')`;
    return isNumeric ? this.ensureFloat(raw) : raw;
  },

  // ============================================================
  // Data Types
  // ============================================================

  getDataType(dataType: DataType): string {
    switch (dataType) {
      case "string":
        return "VARCHAR";
      case "integer":
        return "INTEGER";
      case "float":
        return "FLOAT";
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
  // Quantile (optional - not all DBs support this)
  // ============================================================

  hasEfficientPercentile(): boolean {
    return true;
  },

  hasQuantileTesting(): boolean {
    return true;
  },
};

/**
 * Create a custom dialect by merging overrides with the base dialect.
 * This is a helper for creating database-specific dialects.
 *
 * @example
 * const myDialect = createDialect({
 *   formatDialect: "postgresql",
 *   dateDiff: (start, end) => `${end}::DATE - ${start}::DATE`,
 * });
 */
export function createDialect<T extends Partial<SqlDialect>>(
  overrides: T
): SqlDialect & T {
  return {
    ...baseDialect,
    ...overrides,
  } as SqlDialect & T;
}
