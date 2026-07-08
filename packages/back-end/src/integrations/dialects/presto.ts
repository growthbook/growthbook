import type { SqlDialect } from "shared/types/sql";
import { defaultPercentileCapSelectClause } from "back-end/src/integrations/sql/clauses/percentile-cap-select-clause";
import {
  approxTopKCapacity,
  eligibleTopValueExpr,
} from "back-end/src/integrations/sql/clauses/approx-top-values";
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
  percentileCapSelectClause: (values, metricTable, where = "") =>
    defaultPercentileCapSelectClause(prestoDialect, values, metricTable, where),

  // UNNEST with parallel arrays (rather than ARRAY[ROW(...)]) works on both
  // older Presto and newer Trino, where the row-expansion behavior of
  // UNNEST(ARRAY[ROW(...)]) AS t(a, b) is not consistent across versions.
  unpivotLabeledPairs: (pairs) => {
    const namesArr = pairs.map((p) => `'${p.keyLiteral}'`).join(", ");
    const valsArr = pairs.map((p) => p.valueSql).join(", ");
    return {
      fromContinuation: `CROSS JOIN UNNEST(
        ARRAY[${namesArr}],
        ARRAY[${valsArr}]
      ) AS __col(column_name, value)`,
      keyExpr: "__col.column_name",
      valueExpr: "__col.value",
    };
  },

  approxTopValuesCTEBody: ({
    pairs,
    fromTable,
    whereClause,
    limit,
    maxValueLength,
  }) => {
    const capacity = approxTopKCapacity(limit);
    const names = pairs.map((p) => `'${p.keyLiteral}'`).join(", ");
    const maps = pairs
      .map(
        (p) =>
          `approx_most_frequent(${limit}, ${eligibleTopValueExpr(
            prestoDialect,
            p.valueSql,
            maxValueLength,
          )}, ${capacity})`,
      )
      .join(",\n        ");

    return `
    SELECT __col.column_name AS column_name, __item.value AS value, __item.count AS count
    FROM (
      SELECT
        ARRAY[${names}] AS col_names,
        ARRAY[
          ${maps}
        ] AS col_maps
      FROM ${fromTable}
      WHERE ${whereClause}
    ) __agg
    CROSS JOIN UNNEST(__agg.col_names, __agg.col_maps) AS __col (column_name, items)
    CROSS JOIN UNNEST(__col.items) AS __item (value, count)
    WHERE __item.value IS NOT NULL`;
  },
};
