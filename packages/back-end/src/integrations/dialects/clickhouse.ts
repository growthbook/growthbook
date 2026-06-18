import { createLikeStringMatchFn } from "shared/sql";
import type { DateTruncGranularity, SqlDialect } from "shared/types/sql";
import { defaultPercentileCapSelectClause } from "back-end/src/integrations/sql/clauses/percentile-cap-select-clause";
import { baseDialect } from "./base";

const clickHouseEscapeStringLiteral = (value: string) =>
  value.replace(/\\/g, "\\\\").replace(/'/g, "''");

const SAFE_CH_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

// Quote a native-JSON subcolumn key. The key is a single top-level JSON field
// (may contain spaces/dots/etc.), so backtick-quote it as one identifier when
// it isn't a safe bare identifier — `attributes.company id` is invalid SQL,
// `attributes.\`company id\`` is correct.
const quoteClickHouseJsonPath = (path: string): string =>
  SAFE_CH_IDENTIFIER.test(path) ? path : `\`${path.replace(/`/g, "``")}\``;

export const clickHouseDialect: SqlDialect = {
  ...baseDialect,
  formatDialect: "clickhouse",
  escapeStringLiteral: clickHouseEscapeStringLiteral,
  stringMatch: createLikeStringMatchFn({
    escapeStringLiteral: clickHouseEscapeStringLiteral,
    emitEscapeClause: false,
  }),
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
      // ::Nullable(String) + toFloat64OrNull so a native-JSON path with
      // mixed/off-type values (e.g. an attribute retyped string<->number) yields
      // NULL instead of throwing at query time. toFloat64 alone errors on any
      // non-numeric value, and a plain ::String cast throws on a missing path
      // (can't cast NULL to non-Nullable String) — Nullable(String) keeps NULL.
      return `
if(
  toTypeName(${jsonCol}) = 'JSON',
  toFloat64OrNull(${jsonCol}.${quoteClickHouseJsonPath(path)}::Nullable(String)),
  JSONExtractFloat(${jsonCol}, '${path}')
)
      `;
    }
    // ::Nullable(String) (not .:String): coerce bool/date/array/number values to
    // their string form instead of NULLing them out, while keeping NULL for missing
    // paths (.:String only surfaces String-typed values; IS NULL stays correct).
    return `
if(
  toTypeName(${jsonCol}) = 'JSON',
  ${jsonCol}.${quoteClickHouseJsonPath(path)}::Nullable(String),
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
