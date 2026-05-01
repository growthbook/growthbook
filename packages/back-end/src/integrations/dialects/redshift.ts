import type { SqlDialect } from "shared/types/sql";
import { baseDialect } from "./base";

export const redshiftDialect: SqlDialect = {
  ...baseDialect,
  formatDialect: "redshift",
  formatDate: (col: string) => `to_char(${col}, 'YYYY-MM-DD')`,
  formatDateTimeString: (col: string) =>
    `to_char(${col}, 'YYYY-MM-DD HH24:MI:SS.MS')`,
  castToFloat: (col: string) => `${col}::float`,
  hasCountDistinctHLL: () => true,
  hllAggregate: (col: string) => `HLL_CREATE_SKETCH(${col})`,
  hllReaggregate: (col: string) => `HLL_COMBINE(${col})`,
  hllCardinality: (col: string) => `HLL_CARDINALITY(${col})`,
  jsonExtract: (jsonCol: string, path: string, isNumeric: boolean) => {
    const raw = `JSON_EXTRACT_PATH_TEXT(${jsonCol}, ${path
      .split(".")
      .map((p) => `'${p}'`)
      .join(", ")}, TRUE)`;
    return isNumeric ? redshiftDialect.castToFloat(raw) : raw;
  },
  percentileApprox: (value: string, quantile: string | number) =>
    `PERCENTILE_CONT(${quantile}) WITHIN GROUP (ORDER BY ${value})`,
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
  ) => `
      SELECT
        ${values
          .map(({ valueCol, outputCol, percentile, ignoreZeros }) => {
            const value = ignoreZeros
              ? redshiftDialect.ifElse(`${valueCol} = 0`, "NULL", valueCol)
              : valueCol;
            return `(SELECT ${redshiftDialect.percentileApprox(value, percentile)} FROM ${metricTable} ${where}) AS ${outputCol}`;
          })
          .join(",\n        ")}
      `,
};
