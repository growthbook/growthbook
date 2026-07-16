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
  // HLL_CREATE_SKETCH/HLL_COMBINE already return Redshift's native HLLSKETCH
  // type. The base dialect's default of VARBINARY doesn't apply here — Redshift
  // has no cast path from HLLSKETCH to VARBINARY/VARBYTE, so CAST(... AS
  // VARBINARY) fails with "cannot cast type hllsketch to binary varying".
  // Casting to HLLSKETCH instead is a no-op that keeps the column typed
  // correctly for later HLL_COMBINE/HLL_CARDINALITY calls.
  getDataType: (dataType: DataType): string => {
    switch (dataType) {
      case "string":
        return "VARCHAR";
      case "integer":
        return "INTEGER";
      case "float":
        return "DOUBLE";
      case "boolean":
        return "BOOLEAN";
      case "date":
        return "DATE";
      case "timestamp":
        return "TIMESTAMP";
      case "hll":
        return "HLLSKETCH";
      case "quantileSketch":
        // Quantile sketches aren't supported on Redshift (quantileSketchInit
        // etc. fall back to the base dialect's "not supported" errors), so
        // this value is never actually used to build SQL.
        return "VARBINARY";
      default: {
        const _: never = dataType;
        throw new Error(`Unsupported data type: ${dataType}`);
      }
    }
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
