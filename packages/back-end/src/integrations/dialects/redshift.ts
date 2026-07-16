import type { DataType } from "shared/types/integrations";
import { createLikeStringMatchFn } from "shared/sql";
import type { SqlDialect } from "shared/types/sql";
import { indicesTableUnpivot } from "back-end/src/integrations/sql/clauses/indices-table-unpivot";
import { baseDialect } from "./base";

const redshiftEscapeStringLiteral = (value: string) =>
  value.replace(/\\/g, "\\\\").replace(/'/g, "''");

export const redshiftDialect: SqlDialect = {
  ...baseDialect,
  formatDialect: "redshift",
  escapeStringLiteral: redshiftEscapeStringLiteral,
  stringMatch: createLikeStringMatchFn({
    escapeStringLiteral: redshiftEscapeStringLiteral,
    emitEscapeClause: true,
  }),
  formatDate: (col: string) => `to_char(${col}, 'YYYY-MM-DD')`,
  formatDateTimeString: (col: string) =>
    `to_char(${col}, 'YYYY-MM-DD HH24:MI:SS.MS')`,
  castToFloat: (col: string) => `${col}::float`,
  hasCountDistinctHLL: () => true,
  hllAggregate: (col: string) => `HLL_CREATE_SKETCH(${col})`,
  hllReaggregate: (col: string) => `HLL_COMBINE(${col})`,
  hllCardinality: (col: string) => `HLL_CARDINALITY(${col})`,
  // HLL_CREATE_SKETCH/HLL_COMBINE return HLLSKETCH; casting to VARBINARY fails, so cast to HLLSKETCH (no-op) instead.
  getDataType: (dataType: DataType): string => {
    return dataType === "hll" ? "HLLSKETCH" : baseDialect.getDataType(dataType);
  },
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

  // Redshift's LATERAL keyword only applies to nested SUPER data, not regular
  // relational subqueries — both `CROSS JOIN LATERAL (VALUES ...)` and
  // `CROSS JOIN LATERAL (SELECT ... UNION ALL ...)` are syntax errors.
  unpivotLabeledPairs: indicesTableUnpivot,

  arrayElement: (arrayCol: string, index: number) =>
    redshiftDialect.castToFloat(`${arrayCol}[${index}]`),
};
