import type { DataType } from "shared/types/integrations";
import type { SqlDialect } from "shared/types/sql";
import { defaultPercentileCapSelectClause } from "back-end/src/integrations/sql/clauses/percentile-cap-select-clause";
import { getTopNPerColumnQuery } from "back-end/src/integrations/sql/queries/top-n-per-column";
import { baseDialect } from "./base";

export const snowflakeDialect: SqlDialect = {
  ...baseDialect,
  formatDialect: "snowflake",
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

  supportsEfficientTopValues: () => true,
  getTopValuesCTEBody: (dialect, { columns, start, limit, maxValueLength }) => {
    // Unpivot via LATERAL FLATTEN over an array of OBJECTs so the fact table
    // is scanned once regardless of how many columns we're sampling.
    const objects = columns
      .map(
        (c) =>
          `OBJECT_CONSTRUCT('column_name', '${c.column}', 'value', ${dialect.castToString(
            c.column,
          )})`,
      )
      .join(",\n        ");
    const lengthFilter =
      maxValueLength !== undefined
        ? `AND ${dialect.stringLength("__col.value:value::VARCHAR")} <= ${maxValueLength}`
        : "";
    const aggQuery = `
      SELECT
        __col.value:column_name::VARCHAR AS column_name,
        __col.value:value::VARCHAR AS value,
        COUNT(*) AS count
      FROM __factTable,
      LATERAL FLATTEN(input => ARRAY_CONSTRUCT(
        ${objects}
      )) __col
      WHERE timestamp >= ${dialect.toTimestamp(start)}
        AND __col.value:value::VARCHAR IS NOT NULL
        ${lengthFilter}
      GROUP BY column_name, value`;
    return getTopNPerColumnQuery(aggQuery, limit);
  },
};
