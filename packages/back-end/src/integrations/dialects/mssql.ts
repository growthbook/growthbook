import type { DateTruncGranularity, SqlDialect } from "shared/types/sql";
import { defaultPercentileCapSelectClause } from "back-end/src/integrations/sql/clauses/percentile-cap-select-clause";
import { baseDialect } from "./base";

export const mssqlDialect: SqlDialect = {
  ...baseDialect,
  formatDialect: "tsql",
  selectStarLimit: (table: string, limit: number) =>
    `SELECT TOP ${limit} * FROM ${table}`,
  addTime: (
    col: string,
    unit: "hour" | "minute",
    sign: "+" | "-",
    amount: number,
  ) => `DATEADD(${unit}, ${sign === "-" ? "-" : ""}${amount}, ${col})`,
  dateTrunc: (col: string, granularity: DateTruncGranularity = "day") => {
    if (granularity === "day") {
      return `cast(${col} as DATE)`;
    }
    return `DATETRUNC(${granularity}, ${col})`;
  },
  castToFloat: (col: string) => `CAST(${col} as FLOAT)`,
  formatDate: (col: string) => `FORMAT(${col}, 'yyyy-MM-dd')`,
  castToString: (col: string) => `cast(${col} as varchar(256))`,
  formatDateTimeString: (col: string) => `CONVERT(VARCHAR(25), ${col}, 121)`,
  percentileApprox: (value: string, quantile: string | number) =>
    `APPROX_PERCENTILE_CONT(${quantile}) WITHIN GROUP (ORDER BY ${value})`,
  jsonExtract: (jsonCol: string, path: string, isNumeric: boolean) => {
    const raw = `JSON_VALUE(${jsonCol}, '$.${path}')`;
    return isNumeric ? mssqlDialect.castToFloat(raw) : raw;
  },
  evalBoolean: (col: string, value: boolean) => `${col} = ${value ? "1" : "0"}`,
  percentileCapSelectClause: (values, metricTable, where = "") =>
    defaultPercentileCapSelectClause(mssqlDialect, values, metricTable, where),
};
