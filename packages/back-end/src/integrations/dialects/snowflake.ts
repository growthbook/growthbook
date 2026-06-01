import type { DataType } from "shared/types/integrations";
import type { SqlDialect } from "shared/types/sql";
import { defaultPercentileCapSelectClause } from "back-end/src/integrations/sql/clauses/percentile-cap-select-clause";
import { indicesTableUnpivot } from "back-end/src/integrations/sql/clauses/indices-table-unpivot";
import { baseDialect } from "./base";

export const snowflakeDialect: SqlDialect = {
  ...baseDialect,
  formatDialect: "snowflake",
  escapeStringLiteral: (value: string) =>
    value.replace(/\\/g, "\\\\").replace(/'/g, "''"),
  formatDate: (col: string) => `TO_VARCHAR(${col}, 'YYYY-MM-DD')`,
  formatDateTimeString: (col: string) =>
    `TO_VARCHAR(${col}, 'YYYY-MM-DD HH24:MI:SS.MS')`,
  castToString: (col: string) => `TO_VARCHAR(${col})`,
  castToFloat: (col: string) => `CAST(${col} AS DOUBLE)`,
  hasCountDistinctHLL: () => true,
  hllAggregate: (col: string) => `HLL_ACCUMULATE(${col})`,
  hllReaggregate: (col: string) => `HLL_COMBINE(${col})`,
  hllCardinality: (col: string) => `HLL_ESTIMATE(${col})`,
  // Snowflake uses the t-digest family (APPROX_PERCENTILE_ACCUMULATE/COMBINE/ESTIMATE) to
  // approximate quantiles.
  // t-digest state is returned as an OBJECT (JSON), so quantileSketch storage columns use
  // OBJECT (not BINARY like HLL — see getDataType below).
  quantileSketchInit: (col: string) => `APPROX_PERCENTILE_ACCUMULATE(${col})`,
  quantileSketchMergePartial: (col: string) =>
    `APPROX_PERCENTILE_COMBINE(${col})`,
  quantileSketchExtractPoint: (col: string, quantile: number) =>
    `APPROX_PERCENTILE_ESTIMATE(${col}, ${quantile})`,
  quantileSketchRankApprox: (
    sketchCol: string,
    thresholdCol: string,
    nEventsCol: string,
    numQuantiles: number,
  ) => {
    // Estimate the fraction of the sketch's distribution that lies below
    // `thresholdCol` by sampling the inverse CDF at numQuantiles+1 evenly
    // spaced points (p = 0, 1/n, 2/n, ..., 1) and counting how many of those
    // quantile estimates fall below the threshold. Multiply by nEventsCol /
    // numQuantiles to convert that fraction into an approximate event count.
    //
    // The expression is unrolled into a sum of CASE WHEN terms — each grid
    // point is its own APPROX_PERCENTILE_ESTIMATE call in the SELECT list —
    // rather than built from a CDF array scanned by a subquery. Snowflake
    // can't decorrelate a scalar subquery whose FROM clause references outer
    // columns (e.g. TABLE(FLATTEN(input => <expr using sketchCol>))), and
    // both sketchCol and thresholdCol are outer-row references here. Same
    // family of restriction as the unpivotLabeledPairs failures noted
    // further down. Per-row cost is linear in numQuantiles.
    //
    // NULL-handling: if the sketch is NULL, every APPROX_PERCENTILE_ESTIMATE
    // returns NULL, so each CASE WHEN takes the ELSE 0 branch (NULL <
    // threshold is unknown/false). The sum is 0 and COALESCE is a no-op.
    // The COALESCE only fires when nEventsCol is NULL (0 * NULL = NULL).
    const sumBelow = Array.from(
      { length: numQuantiles + 1 },
      (_, i) =>
        `CASE WHEN APPROX_PERCENTILE_ESTIMATE(${sketchCol}, ${(
          i / numQuantiles
        ).toFixed(6)}) < ${thresholdCol} THEN 1 ELSE 0 END`,
    ).join(" + ");
    return `COALESCE((${sumBelow}) * ${nEventsCol} / ${numQuantiles}.0, 0)`;
  },
  jsonExtract: (jsonCol: string, path: string, isNumeric: boolean) =>
    `PARSE_JSON(${jsonCol}):${path}::${isNumeric ? "float" : "string"}`,
  evalBoolean: (col: string, value: boolean) =>
    `${col} = ${value ? "true" : "false"}`,
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
        return "BINARY";
      case "quantileSketch":
        // t-digest state is an OBJECT, not BINARY (unlike HLL_ACCUMULATE).
        // The round-trip via INSERT/SELECT preserves the OBJECT shape that
        // APPROX_PERCENTILE_COMBINE/ESTIMATE expect.
        return "OBJECT";
      default: {
        const _: never = dataType;
        throw new Error(`Unsupported data type: ${dataType}`);
      }
    }
  },
  percentileCapSelectClause: (values, metricTable, where = "") =>
    defaultPercentileCapSelectClause(
      snowflakeDialect,
      values,
      metricTable,
      where,
    ),

  // Two LATERAL patterns have failed on Snowflake:
  //   - LATERAL FLATTEN(input => ARRAY_CONSTRUCT(OBJECT_CONSTRUCT(...))) does
  //     not reliably correlate column refs inside the constructed array
  //     ("invalid identifier" at runtime).
  //   - LATERAL (SELECT ... UNION ALL ...) is rejected as an "Unsupported
  //     subquery type" because Snowflake's correlated subqueries can't contain
  //     set operations.
  unpivotLabeledPairs: indicesTableUnpivot,
};
