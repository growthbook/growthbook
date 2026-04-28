import type { DataType } from "shared/types/integrations";
import type { DateTruncGranularity, SqlDialect } from "shared/types/sql";
import { defaultPercentileCapSelectClause } from "back-end/src/integrations/sql/clauses/percentile-cap-select-clause";

export const baseDialect: SqlDialect = {
  escapeStringLiteral: (value: string) => value.replace(/'/g, `''`),

  jsonExtract: (jsonCol: string, path: string, isNumeric: boolean) => {
    const raw = `json_extract_scalar(${jsonCol}, '$.${path}')`;
    return isNumeric ? baseDialect.castToFloat(raw) : raw;
  },

  evalBoolean: (col: string, value: boolean) =>
    `${col} IS ${value ? "TRUE" : "FALSE"}`,

  dateTrunc: (col: string, granularity: DateTruncGranularity = "day") =>
    `date_trunc('${granularity}', ${col})`,

  dateDiff: (startCol: string, endCol: string) =>
    `datediff(day, ${startCol}, ${endCol})`,

  percentileApprox: (column: string, percentile: number | string) =>
    `APPROX_PERCENTILE(${column}, ${percentile})`,

  toTimestamp: (date: Date) =>
    `'${date.toISOString().substr(0, 19).replace("T", " ")}'`,

  // Important: If overriding `castToFloat` in a dialect, you must also override
  // `jsonExtract` since it references this method
  castToFloat: (col: string) => col,

  castToString: (col: string) => `cast(${col} as varchar)`,

  castToDate: (col: string) => `CAST(${col} AS DATE)`,

  castUserDateCol: (column: string) => column,

  getCurrentTimestamp: () => `CURRENT_TIMESTAMP`,

  ifElse: (condition: string, ifTrue: string, ifFalse: string) =>
    `(CASE WHEN ${condition} THEN ${ifTrue} ELSE ${ifFalse} END)`,

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
        return "VARBINARY";
      case "kll":
        return "VARBINARY";
      default: {
        const _: never = dataType;
        throw new Error(`Unsupported data type: ${dataType}`);
      }
    }
  },

  addTime: (
    col: string,
    unit: "hour" | "minute",
    sign: "+" | "-",
    amount: number,
  ) => `${col} ${sign} INTERVAL '${amount} ${unit}s'`,

  formatDate: (col: string) => col,

  formatDateTimeString: (col: string) => baseDialect.castToString(col),

  selectStarLimit: (table: string, limit: number) =>
    `SELECT * FROM ${table} LIMIT ${limit}`,

  defaultSchema: "",

  formatDialect: "",

  percentileCapSelectClause: (values, metricTable, where = "") =>
    defaultPercentileCapSelectClause(baseDialect, values, metricTable, where),

  hasCountDistinctHLL: () => false,

  hllAggregate: () => {
    throw new Error(
      "COUNT DISTINCT is not supported for fact metrics in this data source.",
    );
  },

  hllReaggregate: () => {
    throw new Error(
      "COUNT DISTINCT is not supported for fact metrics in this data source.",
    );
  },

  hllCardinality: () => {
    throw new Error(
      "COUNT DISTINCT is not supported for fact metrics in this data source.",
    );
  },

  kllInit: () => {
    throw new Error(
      "KLL quantile sketches are not supported by this data source.",
    );
  },

  kllMergePartial: () => {
    throw new Error(
      "KLL quantile sketches are not supported by this data source.",
    );
  },

  kllExtractPoint: () => {
    throw new Error(
      "KLL quantile sketches are not supported by this data source.",
    );
  },

  kllExtractQuantiles: () => {
    throw new Error(
      "KLL quantile sketches are not supported by this data source.",
    );
  },

  kllRankApprox: () => {
    throw new Error(
      "KLL rank approximation is not implemented for this data source.",
    );
  },
};
