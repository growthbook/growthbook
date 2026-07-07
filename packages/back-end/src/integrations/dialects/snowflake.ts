import type { DataType } from "shared/types/integrations";
import type { SqlDialect } from "shared/types/sql";
import { defaultPercentileCapSelectClause } from "back-end/src/integrations/sql/clauses/percentile-cap-select-clause";
import { baseDialect } from "./base";

export const snowflakeDialect: SqlDialect = {
  ...baseDialect,
  formatDialect: "snowflake",
  escapeStringLiteral: (value: string) =>
    value.replace(/\\/g, "\\\\").replace(/'/g, "''"),
  formatDate: (col: string) => `TO_VARCHAR(${col}, 'YYYY-MM-DD')`,
  formatDateTimeString: (col: string) =>
    `TO_VARCHAR(${col}, 'YYYY-MM-DD HH24:MI:SS.MS')`,
  castToString: (col: string) => `TO_VARCHAR(${col})`,
  castToFloat: (col: string) => `CAST(${col} AS DOUBLE)`,
  hasCountDistinctHLL: () => true,
  hllAggregate: (col: string) => `HLL_ACCUMULATE(${col})`,
  hllReaggregate: (col: string) => `HLL_COMBINE(${col})`,
  hllCardinality: (col: string) => `HLL_ESTIMATE(${col})`,
  jsonExtract: (jsonCol: string, path: string, isNumeric: boolean) =>
    `PARSE_JSON(${jsonCol}):${path}::${isNumeric ? "float" : "string"}`,
  evalBoolean: (col: string, value: boolean) =>
    `${col} = ${value ? "true" : "false"}`,
  // Snowflake aggregate-with-sort uses `WITHIN GROUP`. NULLs are skipped
  // by ARRAY_AGG by default, so no extra IGNORE NULLS needed.
  arrayAggSorted: (col: string) =>
    `ARRAY_AGG(${col}) WITHIN GROUP (ORDER BY ${col})`,
  // MIN_BY has shipped on Snowflake since 2023 — picks `valueCol` from the
  // row with the minimum `tsCol` (NULL timestamps are skipped).
  argMinByTimestamp: (valueCol: string, tsCol: string) =>
    `MIN_BY(${valueCol}, ${tsCol})`,
  arrayMinInRange: (col, lowerBound, upperBound) => {
    // Snowflake's array elements are VARIANT; cast each back to TIMESTAMP
    // for the bounds comparison. `value` is the element column on the
    // FLATTEN output table; aliasing it as `t` keeps the predicate prose
    // identical to the other dialects.
    const tExpr = `f.value::TIMESTAMP`;
    const conditions: string[] = [];
    if (lowerBound) conditions.push(`${tExpr} >= ${lowerBound}`);
    if (upperBound) conditions.push(`${tExpr} <= ${upperBound}`);
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    return `(SELECT MIN(${tExpr}) FROM TABLE(FLATTEN(input => ${col})) f ${where})`;
  },
  addIntervalSeconds: (col: string, sign: "+" | "-", amount: number) =>
    `DATEADD(second, ${sign === "-" ? "-" : ""}${amount}, ${col})`,
  dateDiffMs: (startCol: string, endCol: string) =>
    `DATEDIFF(millisecond, ${startCol}, ${endCol})`,
  getDataType: (dataType: DataType): string => {
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
      case "kll":
        return "BINARY";
      default: {
        const _: never = dataType;
        throw new Error(`Unsupported data type: ${dataType}`);
      }
    }
  },
  percentileCapSelectClause: (values, metricTable, where = "") =>
    defaultPercentileCapSelectClause(
      snowflakeDialect,
      values,
      metricTable,
      where,
    ),
};
