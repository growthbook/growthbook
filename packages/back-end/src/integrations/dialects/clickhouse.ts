import type { DateTruncGranularity, SqlDialect } from "shared/types/sql";
import { defaultPercentileCapSelectClause } from "back-end/src/integrations/sql/clauses/percentile-cap-select-clause";
import { baseDialect } from "./base";

export const clickHouseDialect: SqlDialect = {
  ...baseDialect,
  formatDialect: "clickhouse",
  escapeStringLiteral: (value: string) =>
    value.replace(/\\/g, "\\\\").replace(/'/g, "''"),
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
  dateDiffMs: (startCol: string, endCol: string) =>
    `dateDiff('millisecond', ${startCol}, ${endCol})`,
  addIntervalSeconds: (col: string, sign: "+" | "-", amount: number) =>
    `date${sign === "+" ? "Add" : "Sub"}(second, ${amount}, ${col})`,
  formatDate: (col: string) => `formatDateTime(${col}, '%F')`,
  formatDateTimeString: (col: string) =>
    `formatDateTime(${col}, '%Y-%m-%d %H:%i:%S.%f')`,
  ifElse: (condition: string, ifTrue: string, ifFalse: string) =>
    `if(${condition}, ${ifTrue}, ${ifFalse})`,
  castToDate: (col: string) => {
    const columType = col === "NULL" ? "Nullable(DATE)" : "DATE";
    return `CAST(${col} AS ${columType})`;
  },
  castToTimestamp: (col: string) => {
    // CH demands `Nullable(...)` to hold NULL; `DateTime` alone rejects it.
    const colType = col === "NULL" ? "Nullable(DateTime)" : "DateTime";
    return `CAST(${col} AS ${colType})`;
  },

  // ClickHouse uses functional array operators (no `unnest`-style relational
  // expansion). These match the funnel SQL's array-based step resolution.
  arrayAggSorted: (col: string) =>
    // groupArrayIf skips NULLs entirely; we then sort ascending.
    `arraySort(groupArrayIf(${col}, isNotNull(${col})))`,

  argMinByTimestamp: (valueCol: string, tsCol: string) =>
    `argMinIf(${valueCol}, ${tsCol}, isNotNull(${tsCol}))`,

  arrayMinInRange: (col, lowerBound, upperBound) => {
    const preds: string[] = [];
    if (lowerBound) preds.push(`x >= ${lowerBound}`);
    if (upperBound) preds.push(`x <= ${upperBound}`);
    const predicate = preds.length ? preds.join(" AND ") : "1";
    // `arrayMin([])` returned 0/epoch in older CH versions, which would
    // pollute downstream DateTime math; guard with a length check so the
    // result is properly NULL when no element falls in the window.
    const filtered = `arrayFilter(x -> ${predicate}, ${col})`;
    return `if(length(${filtered}) > 0, arrayMin(${filtered}), NULL)`;
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
  // Use binding names distinct from the outer SELECT aliases (column_name,
  // value) to avoid ClickHouse's "Duplicate alias in ARRAY JOIN" error.
  unpivotLabeledPairs: (pairs) => {
    const namesArr = pairs.map((p) => `'${p.keyLiteral}'`).join(", ");
    const valsArr = pairs.map((p) => p.valueSql).join(", ");
    return {
      fromContinuation: `ARRAY JOIN
        [${namesArr}] AS __col_name,
        [${valsArr}] AS __col_value`,
      keyExpr: "__col_name",
      valueExpr: "__col_value",
    };
  },

  // ClickHouse's LENGTH returns bytes (not characters); that's stricter
  // than JS .length but fine for the document-size guard.
  stringLength: (column: string) => `length(${column})`,
};
