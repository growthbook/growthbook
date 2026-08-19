import { createLikeStringMatchFn } from "shared/sql";
import type { DateTruncGranularity, SqlDialect } from "shared/types/sql";
import { baseDialect } from "./base";

const mysqlEscapeStringLiteral = (value: string) =>
  value.replace(/\\/g, "\\\\").replace(/'/g, "''");

export const mysqlDialect: SqlDialect = {
  ...baseDialect,
  identifierQuote: "`",
  formatDialect: "mysql",
  dateDiff: (startCol: string, endCol: string) =>
    `DATEDIFF(${endCol}, ${startCol})`,
  dateDiffMs: (startCol: string, endCol: string) =>
    `(TIMESTAMPDIFF(MICROSECOND, ${startCol}, ${endCol}) / 1000)`,
  addIntervalSeconds: (col: string, sign: "+" | "-", amount: number) =>
    `DATE_${sign === "+" ? "ADD" : "SUB"}(${col}, INTERVAL ${amount} SECOND)`,
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
  castToTimestamp: (col: string) => `CAST(${col} AS DATETIME)`,
  // MySQL's JSON_ARRAYAGG does not support ORDER BY or filtering out NULLs,
  // so it cannot satisfy the arrayAggSorted contract. Do not override the
  // base implementation until MySQL can produce the required array safely.
  // arrayAggSorted: (col: string) => `JSON_ARRAYAGG(${col})`,
  argMinByTimestamp: (valueCol: string, tsCol: string) =>
    `CAST(FROM_BASE64(SUBSTRING_INDEX(GROUP_CONCAT(IF(${tsCol} IS NULL, NULL, TO_BASE64(CAST(${valueCol} AS BINARY))) ORDER BY ${tsCol}), ',', 1)) AS CHAR)`,
  arrayMinInRange: (col, lowerBound, upperBound) => {
    const conditions: string[] = [];
    if (lowerBound) conditions.push(`t.value >= ${lowerBound}`);
    if (upperBound) conditions.push(`t.value <= ${upperBound}`);
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    return `(SELECT MIN(t.value) FROM JSON_TABLE(${col}, '$[*]' COLUMNS (value DATETIME(6) PATH '$')) AS t ${where})`;
  },
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
  // MySQL 8.0.14+ LATERAL derived table; requires MySQL 8 for window functions in top-N ranking.
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

  stringLength: (column: string) => `CHAR_LENGTH(${column})`,

  stringMatch: createLikeStringMatchFn({
    escapeStringLiteral: mysqlEscapeStringLiteral,
    emitEscapeClause: false,
  }),

  escapeStringLiteral: mysqlEscapeStringLiteral,

  arrayElement: (arrayCol: string, index: number) =>
    mysqlDialect.castToFloat(`JSON_EXTRACT(${arrayCol}, '$[${index}]')`),
};
