import type { DateTruncGranularity, SqlDialect } from "shared/types/sql";
import { defaultPercentileCapSelectClause } from "back-end/src/integrations/sql/clauses/percentile-cap-select-clause";
import { getTopNPerColumnQuery } from "back-end/src/integrations/sql/queries/top-n-per-column";
import { baseDialect } from "./base";

export const clickHouseDialect: SqlDialect = {
  ...baseDialect,
  formatDialect: "clickhouse",
  toTimestamp: (date: Date) =>
    `toDateTime('${date
      .toISOString()
      .substr(0, 19)
      .replace("T", " ")}', 'UTC')`,
  getCurrentTimestamp: () => `now()`,
  addTime: (
    col: string,
    unit: "hour" | "minute",
    sign: "+" | "-",
    amount: number,
  ) => `date${sign === "+" ? "Add" : "Sub"}(${unit}, ${amount}, ${col})`,
  dateTrunc: (col: string, granularity: DateTruncGranularity = "day") =>
    `dateTrunc('${granularity}', ${col})`,
  dateDiff: (startCol: string, endCol: string) =>
    `dateDiff('day', ${startCol}, ${endCol})`,
  formatDate: (col: string) => `formatDateTime(${col}, '%F')`,
  formatDateTimeString: (col: string) =>
    `formatDateTime(${col}, '%Y-%m-%d %H:%i:%S.%f')`,
  ifElse: (condition: string, ifTrue: string, ifFalse: string) =>
    `if(${condition}, ${ifTrue}, ${ifFalse})`,
  castToDate: (col: string) => {
    const columType = col === "NULL" ? "Nullable(DATE)" : "DATE";
    return `CAST(${col} AS ${columType})`;
  },
  castToString: (col: string) => `toString(${col})`,
  castToFloat: (col: string) => `toFloat64(${col})`,
  hasCountDistinctHLL: () => true,
  hllAggregate: (col: string) => `uniqState(${col})`,
  hllReaggregate: (col: string) => `uniqMergeState(${col})`,
  hllCardinality: (col: string) => `finalizeAggregation(${col})`,
  percentileApprox: (value: string, quantile: string | number) =>
    `quantile(${quantile})(${value})`,
  jsonExtract: (jsonCol: string, path: string, isNumeric: boolean) => {
    if (isNumeric) {
      return `
if(
  toTypeName(${jsonCol}) = 'JSON', 
  toFloat64(${jsonCol}.${path}),
  JSONExtractFloat(${jsonCol}, '${path}')
)
      `;
    }
    return `
if(
  toTypeName(${jsonCol}) = 'JSON',
  ${jsonCol}.${path}.:String,
  JSONExtractString(${jsonCol}, '${path}')
)
      `;
  },
  evalBoolean: (col: string, value: boolean) =>
    `${col} = ${value ? "true" : "false"}`,
  percentileCapSelectClause: (values, metricTable, where = "") =>
    defaultPercentileCapSelectClause(
      clickHouseDialect,
      values,
      metricTable,
      where,
    ),
  supportsEfficientTopValues: () => true,
  getTopValuesCTEBody: (dialect, { columns, start, limit, maxValueLength }) => {
    // ARRAY JOIN with two parallel arrays zips them element-wise, so the
    // fact table is scanned once and we get one output row per (input row,
    // column) pair.
    const namesArr = columns.map((c) => `'${c.column}'`).join(", ");
    const valsArr = columns
      .map((c) => dialect.castToString(c.column))
      .join(", ");
    const lengthFilter =
      maxValueLength !== undefined
        ? `AND ${dialect.stringLength("value")} <= ${maxValueLength}`
        : "";
    const aggQuery = `
      SELECT column_name, value, COUNT(*) AS count
      FROM __factTable
      ARRAY JOIN
        [${namesArr}] AS column_name,
        [${valsArr}] AS value
      WHERE timestamp >= ${dialect.toTimestamp(start)}
        AND value IS NOT NULL
        ${lengthFilter}
      GROUP BY column_name, value`;
    return getTopNPerColumnQuery(aggQuery, limit);
  },

  // ClickHouse's LENGTH returns bytes (not characters); that's stricter
  // than JS .length but fine for the document-size guard.
  stringLength: (column: string) => `length(${column})`,
};
