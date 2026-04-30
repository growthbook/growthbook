import type { DateTruncGranularity, SqlDialect } from "shared/types/sql";
import { baseDialect } from "./base";

export const mysqlDialect: SqlDialect = {
  ...baseDialect,
  formatDialect: "mysql",
  dateDiff: (startCol: string, endCol: string) =>
    `DATEDIFF(${endCol}, ${startCol})`,
  addTime: (
    col: string,
    unit: "hour" | "minute",
    sign: "+" | "-",
    amount: number,
  ) =>
    `DATE_${
      sign === "+" ? "ADD" : "SUB"
    }(${col}, INTERVAL ${amount} ${unit.toUpperCase()})`,
  dateTrunc: (col: string, granularity: DateTruncGranularity = "day") => {
    const formatMap: Record<DateTruncGranularity, string> = {
      hour: `DATE_FORMAT(${col}, '%Y-%m-%d %H:00:00')`,
      day: `DATE(${col})`,
      week: `DATE(DATE_SUB(${col}, INTERVAL WEEKDAY(${col}) DAY))`,
      month: `DATE_FORMAT(${col}, '%Y-%m-01')`,
      year: `DATE_FORMAT(${col}, '%Y-01-01')`,
    };
    return formatMap[granularity];
  },
  formatDate: (col: string) => `DATE_FORMAT(${col}, "%Y-%m-%d")`,
  formatDateTimeString: (col: string) =>
    `DATE_FORMAT(${col}, "%Y-%m-%d %H:%i:%S")`,
  castToString: (col: string) => `cast(${col} as char)`,
  castToFloat: (col: string) => `CAST(${col} AS DOUBLE)`,
  percentileCapSelectClause: (
    values: {
      valueCol: string;
      outputCol: string;
      percentile: number;
      ignoreZeros: boolean;
      sourceIndex: number;
    }[],
    metricTable: string,
    where: string = "",
  ) => {
    if (values.length > 1) {
      throw new Error(
        "MySQL only supports one percentile capped metric at a time",
      );
    }

    let whereClause = where;
    if (values[0].ignoreZeros) {
      whereClause = whereClause
        ? `${whereClause} AND ${values[0].valueCol} != 0`
        : `WHERE ${values[0].valueCol} != 0`;
    }

    return `
    SELECT DISTINCT FIRST_VALUE(${values[0].valueCol}) OVER (
      ORDER BY CASE WHEN p <= ${values[0].percentile} THEN p END DESC
    ) AS ${values[0].outputCol}
    FROM (
      SELECT
        ${values[0].valueCol},
        PERCENT_RANK() OVER (ORDER BY ${values[0].valueCol}) p
      FROM ${metricTable}
      ${whereClause}
    ) t`;
  },
  jsonExtract: (jsonCol: string, path: string, isNumeric: boolean) => {
    const raw = `JSON_EXTRACT(${jsonCol}, '$.${path}')`;
    return isNumeric ? mysqlDialect.castToFloat(raw) : raw;
  },
  escapeStringLiteral: (value: string) =>
    value.replace(/\\/g, "\\\\").replace(/'/g, "''"),
};
