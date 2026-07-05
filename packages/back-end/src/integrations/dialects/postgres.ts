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
  percentileApprox: (column: string, percentile: number | string) =>
    `PERCENTILE_CONT(${percentile}) WITHIN GROUP (ORDER BY ${column})`,
  // Postgres has no ROUND(double precision, int); cast to numeric first.
  round: (
    expr: string,
    mode: "round" | "floor" | "ceil",
    decimals?: number,
  ) => {
    const d = decimals ?? 0;
    if (mode === "round") return `ROUND(CAST(${expr} AS numeric), ${d})`;
    const fn = mode === "floor" ? "FLOOR" : "CEIL";
    if (d > 0) {
      const factor = Math.pow(10, d);
      return `${fn}((${expr}) * ${factor}) / ${factor}`;
    }
    return `${fn}(${expr})`;
  },
  // Postgres REGEXP_REPLACE replaces only the first match unless the `'g'` flag
  // is passed.
  regexpReplace: (expr: string, pattern: string, replaceWith: string) =>
    `REGEXP_REPLACE(${expr}, ${pattern}, ${replaceWith}, 'g')`,
  // Postgres has no REGEXP_SUBSTR before v15; `substring(x from 'pat')` returns
  // the first match and works everywhere.
  regexpExtract: (expr: string, pattern: string) =>
    `SUBSTRING(${expr} FROM ${pattern})`,
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
