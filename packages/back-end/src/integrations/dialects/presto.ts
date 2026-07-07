import type { SqlDialect } from "shared/types/sql";
import { defaultPercentileCapSelectClause } from "back-end/src/integrations/sql/clauses/percentile-cap-select-clause";
import { baseDialect } from "./base";

export const prestoDialect: SqlDialect = {
  ...baseDialect,
  formatDialect: "trino",
  toTimestamp: (date: Date) =>
    `from_iso8601_timestamp('${date.toISOString()}')`,
  addTime: (
    col: string,
    unit: "hour" | "minute",
    sign: "+" | "-",
    amount: number,
  ) => `${col} ${sign} INTERVAL '${amount}' ${unit}`,
  formatDate: (col: string) => `substr(to_iso8601(${col}),1,10)`,
  formatDateTimeString: (col: string) => `to_iso8601(${col})`,
  dateDiff: (startCol: string, endCol: string) =>
    `date_diff('day', ${startCol}, ${endCol})`,
  castToFloat: (col: string) => `CAST(${col} AS DOUBLE)`,
  jsonExtract: (jsonCol: string, path: string, isNumeric: boolean) => {
    const raw = `json_extract_scalar(${jsonCol}, '$.${path}')`;
    return isNumeric ? prestoDialect.castToFloat(raw) : raw;
  },
  hasCountDistinctHLL: () => true,
  hllAggregate: (col: string) => `APPROX_SET(${col})`,
  hllReaggregate: (col: string) => `MERGE(CAST(${col} AS HyperLogLog))`,
  hllCardinality: (col: string) => `CARDINALITY(${col})`,
  // Same Presto/Trino engine as Athena — array helpers use the functional
  // operators and the native `min_by` aggregate.
  arrayAggSorted: (col: string) =>
    `array_sort(filter(array_agg(${col}), x -> x IS NOT NULL))`,
  argMinByTimestamp: (valueCol: string, tsCol: string) =>
    `min_by(${valueCol}, ${tsCol})`,
  arrayMinInRange: (col, lowerBound, upperBound) => {
    const preds: string[] = [];
    if (lowerBound) preds.push(`x >= ${lowerBound}`);
    if (upperBound) preds.push(`x <= ${upperBound}`);
    const predicate = preds.length ? preds.join(" AND ") : "true";
    return `array_min(filter(${col}, x -> ${predicate}))`;
  },
  addIntervalSeconds: (col: string, sign: "+" | "-", amount: number) =>
    `date_add('second', ${sign === "-" ? "-" : ""}${amount}, ${col})`,
  dateDiffMs: (startCol: string, endCol: string) =>
    `date_diff('millisecond', ${startCol}, ${endCol})`,
  percentileCapSelectClause: (values, metricTable, where = "") =>
    defaultPercentileCapSelectClause(prestoDialect, values, metricTable, where),
};
