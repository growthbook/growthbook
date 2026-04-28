import type { SqlDialect } from "shared/types/sql";
import { defaultPercentileCapSelectClause } from "back-end/src/integrations/sql/clauses/percentile-cap-select-clause";
import { getTopNPerColumnQuery } from "back-end/src/integrations/sql/queries/top-n-per-column";
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
  supportsEfficientTopValues: true,
  getTopValuesCTEBody: (dialect, { columns, start, limit, maxValueLength }) => {
    // Unpivot via CROSS JOIN UNNEST over an array of ROWs, so the fact
    // table is scanned once regardless of how many columns we're sampling.
    const rows = columns
      .map((c) => `ROW('${c.column}', ${dialect.castToString(c.column)})`)
      .join(",\n        ");
    const lengthFilter =
      maxValueLength !== undefined
        ? `AND ${dialect.stringLength("__col.value")} <= ${maxValueLength}`
        : "";
    const aggQuery = `
      SELECT __col.column_name, __col.value, COUNT(*) AS count
      FROM __factTable
      CROSS JOIN UNNEST(ARRAY[
        ${rows}
      ]) AS __col(column_name, value)
      WHERE timestamp >= ${dialect.toTimestamp(start)}
        AND __col.value IS NOT NULL
        ${lengthFilter}
      GROUP BY __col.column_name, __col.value`;
    return getTopNPerColumnQuery(aggQuery, limit);
  },
  stringLength: (column: string) => `LENGTH(${column})`,
};
