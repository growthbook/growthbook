import type { SqlDialect } from "shared/types/sql";
import { defaultPercentileCapSelectClause } from "back-end/src/integrations/sql/clauses/percentile-cap-select-clause";
import { baseDialect } from "./base";

export const verticaDialect: SqlDialect = {
  ...baseDialect,
  formatDialect: "postgresql",
  dateDiff: (startCol: string, endCol: string) =>
    `${endCol}::DATE - ${startCol}::DATE`,
  castToFloat: (col: string) => `${col}::float`,
  formatDate: (col: string) => `to_char(${col}, 'YYYY-MM-DD')`,
  formatDateTimeString: (col: string) =>
    `to_char(${col}, 'YYYY-MM-DD HH24:MI:SS.MS')`,
  jsonExtract: (jsonCol: string, path: string, isNumeric: boolean) => {
    const raw = `MAPLOOKUP(MapJSONExtractor(${jsonCol}), '${path}')`;
    return isNumeric ? verticaDialect.castToFloat(raw) : raw;
  },
  percentileApprox: (value: string, quantile: string | number) =>
    `APPROXIMATE_PERCENTILE(${value} USING PARAMETERS percentiles='${quantile}')`,
  percentileCapSelectClause: (values, metricTable, where = "") =>
    defaultPercentileCapSelectClause(
      verticaDialect,
      values,
      metricTable,
      where,
    ),

  // Vertica's FROM clause only accepts relations and subqueries, not a bare
  // VALUES list, so we emit a UNION ALL chain inside the LATERAL subquery.
  unpivotLabeledPairs: (pairs) => {
    const first = `SELECT '${pairs[0].keyLiteral}' AS column_name, ${pairs[0].valueSql} AS value`;
    const rest = pairs
      .slice(1)
      .map((p) => `UNION ALL SELECT '${p.keyLiteral}', ${p.valueSql}`)
      .join(" ");
    return {
      fromContinuation: `CROSS JOIN LATERAL (
        ${first}
        ${pairs.length > 1 ? `\n${rest}` : ""}
      ) AS __col`,
      keyExpr: "__col.column_name",
      valueExpr: "__col.value",
    };
  },
};
