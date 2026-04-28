import type { DataType } from "shared/types/integrations";
import type { DateTruncGranularity, SqlDialect } from "shared/types/sql";
import { defaultPercentileCapSelectClause } from "back-end/src/integrations/sql/clauses/percentile-cap-select-clause";
import { baseDialect } from "./base";

export const bigQueryDialect: SqlDialect = {
  ...baseDialect,
  formatDialect: "bigquery",
  addTime: (
    col: string,
    unit: "hour" | "minute",
    sign: "+" | "-",
    amount: number,
  ) =>
    `DATETIME_${
      sign === "+" ? "ADD" : "SUB"
    }(${col}, INTERVAL ${amount} ${unit.toUpperCase()})`,
  dateTrunc: (col: string, granularity: DateTruncGranularity = "day") =>
    `date_trunc(${col}, ${granularity.toUpperCase()})`,
  dateDiff: (startCol: string, endCol: string) =>
    `date_diff(${endCol}, ${startCol}, DAY)`,
  formatDate: (col: string) => `format_date("%F", ${col})`,
  formatDateTimeString: (col: string) => `format_datetime("%F %T", ${col})`,
  castToString: (col: string) => `cast(${col} as string)`,
  escapeStringLiteral: (value: string) => value.replace(/(['\\])/g, "\\$1"),
  castUserDateCol: (column: string) => `CAST(${column} as DATETIME)`,
  hasCountDistinctHLL: () => true,
  hllAggregate: (col: string) => `HLL_COUNT.INIT(${col})`,
  hllReaggregate: (col: string) => `HLL_COUNT.MERGE_PARTIAL(${col})`,
  hllCardinality: (col: string) => `HLL_COUNT.EXTRACT(${col})`,
  kllInit: (col: string) => `KLL_QUANTILES.INIT_FLOAT64(${col}, 1000)`,
  kllMergePartial: (col: string) => `KLL_QUANTILES.MERGE_PARTIAL(${col})`,
  kllExtractPoint: (col: string, quantile: number) =>
    `KLL_QUANTILES.EXTRACT_POINT_FLOAT64(${col}, ${quantile})`,
  kllExtractQuantiles: (col: string, numQuantiles: number) =>
    `KLL_QUANTILES.EXTRACT_FLOAT64(${col}, ${numQuantiles})`,
  kllRankApprox: (
    sketchCol: string,
    thresholdCol: string,
    nEventsCol: string,
    numQuantiles: number,
  ) => {
    const cdfArray = bigQueryDialect.kllExtractQuantiles(
      sketchCol,
      numQuantiles,
    );
    const countBelow = `(SELECT COUNT(*) FROM UNNEST(${cdfArray}) AS p WHERE p < ${thresholdCol})`;
    return `COALESCE(${countBelow} * ${nEventsCol} / ${numQuantiles}.0, 0)`;
  },
  percentileApprox: (value: string, quantile: string | number) => {
    const multiplier = 10000;
    const quantileVal = Number(quantile)
      ? Math.trunc(multiplier * Number(quantile))
      : `${multiplier} * ${quantile}`;
    return `APPROX_QUANTILES(${value}, ${multiplier} IGNORE NULLS)[OFFSET(CAST(${quantileVal} AS INT64))]`;
  },
  jsonExtract: (jsonCol: string, path: string, isNumeric: boolean) => {
    const raw = `JSON_VALUE(${jsonCol}, '$.${path}')`;
    return isNumeric ? `CAST(${raw} AS FLOAT64)` : raw;
  },
  getDataType: (dataType: DataType): string => {
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
      case "kll":
        return "BYTES";
      default: {
        const _: never = dataType;
        throw new Error(`Unsupported data type: ${dataType}`);
      }
    }
  },
  getCurrentTimestamp: () => `CURRENT_TIMESTAMP()`,
  percentileCapSelectClause: (values, metricTable, where = "") =>
    defaultPercentileCapSelectClause(
      bigQueryDialect,
      values,
      metricTable,
      where,
    ),
};
