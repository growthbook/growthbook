import type { DataType } from "shared/types/integrations";
import { createLikeStringMatchFn } from "shared/sql";
import type { SqlDialect } from "shared/types/sql";
import { defaultPercentileCapSelectClause } from "back-end/src/integrations/sql/clauses/percentile-cap-select-clause";
import {
  approxTopKCapacity,
  eligibleTopValueExpr,
} from "back-end/src/integrations/sql/clauses/approx-top-values";
import { baseDialect } from "./base";

const databricksEscapeStringLiteral = (value: string) =>
  value.replace(/(['\\])/g, "\\$1");

export const databricksDialect: SqlDialect = {
  ...baseDialect,
  formatDialect: "spark",
  toTimestamp: (date: Date) => `TIMESTAMP'${date.toISOString()}'`,
  addTime: (
    col: string,
    unit: "hour" | "minute",
    sign: "+" | "-",
    amount: number,
  ) => `timestampadd(${unit},${sign === "-" ? "-" : ""}${amount},${col})`,
  formatDate: (col: string) => `date_format(${col}, 'y-MM-dd')`,
  formatDateTimeString: (col: string) =>
    `date_format(${col}, 'y-MM-dd HH:mm:ss.SSS')`,
  castToString: (col: string) => `cast(${col} as string)`,
  castToFloat: (col: string) => `cast(${col} as double)`,
  stringMatch: createLikeStringMatchFn({
    escapeStringLiteral: databricksEscapeStringLiteral,
    emitEscapeClause: false,
  }),
  escapeStringLiteral: databricksEscapeStringLiteral,
  hasCountDistinctHLL: () => true,
  hllAggregate: (col: string) =>
    `HLL_SKETCH_AGG(${databricksDialect.castToString(col)})`,
  hllReaggregate: (col: string) => `HLL_UNION_AGG(${col})`,
  hllCardinality: (col: string) => `HLL_SKETCH_ESTIMATE(${col})`,
  jsonExtract: (jsonCol: string, path: string, isNumeric: boolean) => {
    const raw = `${jsonCol}:${path}`;
    return isNumeric ? databricksDialect.castToFloat(raw) : raw;
  },
  getDataType: (dataType: DataType): string => {
    switch (dataType) {
      case "string":
        return "STRING";
      case "integer":
        return "INT";
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
      case "quantileSketch":
        return "BINARY";
      default: {
        const _: never = dataType;
        throw new Error(`Unsupported data type: ${dataType}`);
      }
    }
  },
  percentileCapSelectClause: (values, metricTable, where = "") =>
    defaultPercentileCapSelectClause(
      databricksDialect,
      values,
      metricTable,
      where,
    ),

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

  arrayElement: (arrayCol: string, index: number) => `${arrayCol}[${index}]`,

  // approx_top_k(expr, k, maxItemsTracked) returns ARRAY<STRUCT<item, count>>
  // per column; explode the array of per-column named_structs, then inline each
  // column's items.
  approxTopValuesCTEBody: ({
    pairs,
    fromTable,
    whereClause,
    limit,
    maxValueLength,
  }) => {
    const maxItemsTracked = approxTopKCapacity(limit);
    const structs = pairs
      .map(
        (p) =>
          `named_struct('column_name', '${p.keyLiteral}', 'items', approx_top_k(${eligibleTopValueExpr(
            databricksDialect,
            p.valueSql,
            maxValueLength,
          )}, ${limit}, ${maxItemsTracked}))`,
      )
      .join(",\n      ");
    return `
  SELECT __col.column_name AS column_name, __item.item AS value, __item.cnt AS count
  FROM (
    SELECT array(
      ${structs}
    ) AS cols
    FROM ${fromTable}
    WHERE ${whereClause}
  ) __agg
  LATERAL VIEW explode(__agg.cols) __t AS __col
  LATERAL VIEW inline(__col.items) __item AS item, cnt
  WHERE __item.item IS NOT NULL`;
  },
};
