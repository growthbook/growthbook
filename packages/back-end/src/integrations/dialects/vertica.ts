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
};
