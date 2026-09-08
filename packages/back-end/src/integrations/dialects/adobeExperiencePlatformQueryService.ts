import { createLikeStringMatchFn } from "shared/sql";
import type { SqlDialect } from "shared/types/sql";
import { defaultPercentileCapSelectClause } from "back-end/src/integrations/sql/clauses/percentile-cap-select-clause";
import { baseDialect } from "./base";

const escapeStringLiteral = (value: string) =>
  value.replace(/(['\\])/g, "\\$1");

export const adobeExperiencePlatformQueryServiceDialect: SqlDialect = {
  ...baseDialect,
  formatDialect: "spark",
  escapeStringLiteral,
  stringMatch: createLikeStringMatchFn({
    escapeStringLiteral,
    emitEscapeClause: false,
  }),
  toTimestamp: (date: Date) => `to_timestamp(${baseDialect.toTimestamp(date)})`,
  castToFloat: (col: string) => `cast(${col} as double)`,
  castToString: (col: string) => `cast(${col} as string)`,
  formatDate: (col: string) => `date_format(${col}, 'y-MM-dd')`,
  formatDateTimeString: (col: string) =>
    `date_format(${col}, 'y-MM-dd HH:mm:ss.SSS')`,
  percentileApprox: (col: string, percentile: number | string) =>
    `percentile_approx(${col}, ${percentile})`,
  jsonExtract: (jsonCol: string, path: string, isNumeric: boolean) => {
    const raw = `get_json_object(${jsonCol}, '$.${path}')`;
    return isNumeric
      ? adobeExperiencePlatformQueryServiceDialect.castToFloat(raw)
      : raw;
  },
  dateDiff: (startCol: string, endCol: string) =>
    `datediff(${endCol}, ${startCol})`,
  arrayAggSorted: (col: string) => `sort_array(collect_list(${col}))`,
  hasCountDistinctHLL: () => false,

  percentileCapSelectClause: (values, metricTable, where = "") =>
    defaultPercentileCapSelectClause(
      adobeExperiencePlatformQueryServiceDialect,
      values,
      metricTable,
      where,
    ),

  argMinByTimestamp: (valueCol: string, tsCol: string) =>
    `min_by(${valueCol}, ${tsCol})`,
  arrayMinInRange: (col, lowerBound, upperBound) => {
    const preds: string[] = [];
    if (lowerBound) preds.push(`x >= ${lowerBound}`);
    if (upperBound) preds.push(`x <= ${upperBound}`);
    const predicate = preds.length ? preds.join(" AND ") : "true";
    return `array_min(filter(${col}, x -> ${predicate}))`;
  },
  dateDiffMs: (startCol: string, endCol: string) =>
    `(unix_millis(${endCol}) - unix_millis(${startCol}))`,
  addIntervalSeconds: (col: string, sign: "+" | "-", amount: number) =>
    `timestampadd(SECOND, ${sign === "-" ? "-" : ""}${amount}, ${col})`,
  arrayElement: (arrayCol: string, index: number) => `${arrayCol}[${index}]`,

  // Qualify the STACK outputs with the __col table alias so they don't become
  // ambiguous if the fact table also projects a column named `column_name` or
  // `value` (the latter is common for metric/event value columns).
  unpivotLabeledPairs: (pairs) => {
    const stackPairs = pairs
      .map((p) => `'${p.keyLiteral}', ${p.valueSql}`)
      .join(", ");
    return {
      fromContinuation: `LATERAL VIEW STACK(${pairs.length},
        ${stackPairs}
      ) __col AS column_name, value`,
      keyExpr: "__col.column_name",
      valueExpr: "__col.value",
    };
  },
};
