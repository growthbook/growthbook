import { createLikeStringMatchFn } from "shared/sql";
import type { SqlDialect } from "shared/types/sql";
import { defaultPercentileCapSelectClause } from "back-end/src/integrations/sql/clauses/percentile-cap-select-clause";
import { baseDialect } from "./base";

export const postgresDialect: SqlDialect = {
  ...baseDialect,
  formatDialect: "postgresql",
  stringMatch: createLikeStringMatchFn({
    escapeStringLiteral: baseDialect.escapeStringLiteral,
    emitEscapeClause: false,
  }),
  dateDiff: (startCol: string, endCol: string) =>
    `${endCol}::DATE - ${startCol}::DATE`,
  dateDiffMs: (startCol: string, endCol: string) =>
    `(EXTRACT(EPOCH FROM (${endCol} - ${startCol})) * 1000)`,
  addIntervalSeconds: (col: string, sign: "+" | "-", amount: number) =>
    `${col} ${sign} INTERVAL '${amount} seconds'`,
  castToFloat: (col: string) => `${col}::float`,
  formatDate: (col: string) => `to_char(${col}, 'YYYY-MM-DD')`,
  formatDateTimeString: (col: string) =>
    `to_char(${col}, 'YYYY-MM-DD HH24:MI:SS.MS')`,
  jsonExtract: (jsonCol: string, path: string, isNumeric: boolean) => {
    const raw = `JSON_EXTRACT_PATH_TEXT(${jsonCol}::json, ${path
      .split(".")
      .map((p) => `'${p}'`)
      .join(", ")})`;
    return isNumeric ? postgresDialect.castToFloat(raw) : raw;
  },
  arrayAggSorted: (col: string) =>
    `ARRAY_AGG(${col} ORDER BY ${col}) FILTER (WHERE ${col} IS NOT NULL)`,
  argMinByTimestamp: (valueCol: string, tsCol: string) =>
    `(ARRAY_AGG(${valueCol} ORDER BY ${tsCol}) FILTER (WHERE ${tsCol} IS NOT NULL))[1]`,
  arrayMinInRange: (col, lowerBound, upperBound) => {
    const conditions: string[] = [];
    if (lowerBound) conditions.push(`t >= ${lowerBound}`);
    if (upperBound) conditions.push(`t <= ${upperBound}`);
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    return `(SELECT MIN(t) FROM unnest(${col}) AS t ${where})`;
  },
  percentileApprox: (column: string, percentile: number | string) =>
    `PERCENTILE_CONT(${percentile}) WITHIN GROUP (ORDER BY ${column})`,
  percentileCapSelectClause: (values, metricTable, where = "") =>
    defaultPercentileCapSelectClause(
      postgresDialect,
      values,
      metricTable,
      where,
    ),
  unpivotLabeledPairs: (pairs) => {
    const valueRows = pairs
      .map((p) => `('${p.keyLiteral}', ${p.valueSql})`)
      .join(", ");
    return {
      fromContinuation: `CROSS JOIN LATERAL (
        VALUES ${valueRows}
      ) AS __col(column_name, value)`,
      keyExpr: "__col.column_name",
      valueExpr: "__col.value",
    };
  },
};
