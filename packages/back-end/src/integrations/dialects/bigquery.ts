import type { DataType } from "shared/types/integrations";
import { createLikeStringMatchFn } from "shared/sql";
import type { DateTruncGranularity, SqlDialect } from "shared/types/sql";
import {
  defaultPercentileCapSelectClause,
  PercentileCapSelectClauseValue,
} from "back-end/src/integrations/sql/clauses/percentile-cap-select-clause";
import { eligibleTopValueExpr } from "back-end/src/integrations/sql/clauses/approx-top-values";
import { baseDialect } from "./base";

const APPROX_QUANTILES_MULTIPLIER = 10000;

// Below this many capped columns, keep the wide single-pass form. The reshape
// path duplicates input rows N× through UNPIVOT and forces a shuffle for
// GROUP BY col_name, which is pure overhead at small N. The wide form fits
// well under BigQuery's 100MB-per-row limit until the column count gets large
// (APPROX_QUANTILES sketch state is bounded by the precision multiplier).
const PERCENTILE_CAP_RESHAPE_THRESHOLD = 10;

/**
 * BigQuery-specific __capValue body: UNPIVOT value columns to long form, compute
 * one APPROX_QUANTILES sketch per column via GROUP BY, then PIVOT the extracted
 * scalar caps back to the wide one-row shape downstream expects.
 *
 * The default wide form emits one APPROX_QUANTILES per capped column in a single
 * ungrouped SELECT. Each sketch carries ~1.5MB of intermediate state at ~40M input
 * rows, so with ~65+ capped columns the single aggregation row exceeds BigQuery's
 * 100MB-per-row limit. chunkMetrics() doesn't see this because it budgets by
 * output-column count, not intermediate sketch state.
 *
 * Reshaping to GROUP BY col_name keeps exactly one sketch per aggregation row, so
 * the per-row footprint is constant regardless of how many capped columns there are.
 * Per-column `percentile` is handled by indexing the per-group sketch array at a
 * CASE-driven offset; per-column `ignoreZeros` is handled by nulling zeros inside
 * the aggregate argument for the opted-in columns.
 */
function bigQueryPercentileCapSelectClause(
  values: PercentileCapSelectClauseValue[],
  metricTable: string,
  where: string = "",
): string {
  // Below the threshold: the wide single-pass form is faster on both wall and
  // slot time (one scan of metricTable, no UNPIVOT row multiplication, no
  // shuffle for GROUP BY). The reshape only pays off once the per-row sketch
  // total approaches BigQuery's 100MB row limit.
  if (values.length < PERCENTILE_CAP_RESHAPE_THRESHOLD) {
    return defaultPercentileCapSelectClause(
      bigQueryDialect,
      values,
      metricTable,
      where,
    );
  }

  const colsByOffset = new Map<number, string[]>();
  for (const { valueCol, percentile } of values) {
    const offset = Math.trunc(APPROX_QUANTILES_MULTIPLIER * percentile);
    const list = colsByOffset.get(offset) ?? [];
    list.push(valueCol);
    colsByOffset.set(offset, list);
  }
  const offsetCase = `CAST(CASE ${[...colsByOffset.entries()]
    .map(
      ([offset, cols]) =>
        `WHEN col_name IN (${cols
          .map((c) => `'${bigQueryDialect.escapeStringLiteral(c)}'`)
          .join(", ")}) THEN ${offset}`,
    )
    .join(" ")} END AS INT64)`;

  const ignoreZeroCols = values
    .filter((v) => v.ignoreZeros)
    .map((v) => `'${bigQueryDialect.escapeStringLiteral(v.valueCol)}'`);
  const valExpr =
    ignoreZeroCols.length > 0
      ? `IF(col_name IN (${ignoreZeroCols.join(", ")}) AND val = 0, NULL, val)`
      : `val`;

  // Project + cast to FLOAT64 so UNPIVOT sees a uniform column type and so no
  // unrelated columns from metricTable are carried through the long-form rows.
  const sourceProjection = values
    .map(({ valueCol }) => `CAST(${valueCol} AS FLOAT64) AS ${valueCol}`)
    .join(", ");

  const unpivotCols = values.map((v) => v.valueCol).join(", ");
  const pivotCols = values
    .map(
      (v) =>
        `'${bigQueryDialect.escapeStringLiteral(v.valueCol)}' AS ${v.outputCol}`,
    )
    .join(", ");

  return `
      SELECT * FROM (
        SELECT
          col_name,
          APPROX_QUANTILES(${valExpr}, ${APPROX_QUANTILES_MULTIPLIER} IGNORE NULLS)[OFFSET(${offsetCase})] AS cap
        FROM (SELECT ${sourceProjection} FROM ${metricTable} ${where})
        UNPIVOT (val FOR col_name IN (${unpivotCols}))
        GROUP BY col_name
      )
      PIVOT (ANY_VALUE(cap) FOR col_name IN (${pivotCols}))
      `;
}

const bigQueryEscapeStringLiteral = (value: string) =>
  value.replace(/(['\\])/g, "\\$1");

export const bigQueryDialect: SqlDialect = {
  ...baseDialect,
  identifierQuote: "`",
  formatDialect: "bigquery",
  addTime: (
    col: string,
    unit: "hour" | "minute",
    sign: "+" | "-",
    amount: number,
  ) =>
    `DATETIME_${
      sign === "+" ? "ADD" : "SUB"
    }(${col}, INTERVAL ${amount} ${unit.toUpperCase()})`,
  dateTrunc: (col: string, granularity: DateTruncGranularity = "day") =>
    `date_trunc(${col}, ${granularity.toUpperCase()})`,
  dateDiff: (startCol: string, endCol: string) =>
    `date_diff(${endCol}, ${startCol}, DAY)`,
  formatDate: (col: string) => `format_date("%F", ${col})`,
  formatDateTimeString: (col: string) => `format_datetime("%F %T", ${col})`,
  castToString: (col: string) => `cast(${col} as string)`,
  stringMatch: createLikeStringMatchFn({
    escapeStringLiteral: bigQueryEscapeStringLiteral,
    emitEscapeClause: false,
  }),
  escapeStringLiteral: bigQueryEscapeStringLiteral,
  castUserDateCol: (column: string) => `CAST(${column} as DATETIME)`,
  hasCountDistinctHLL: () => true,
  hllAggregate: (col: string) => `HLL_COUNT.INIT(${col})`,
  hllReaggregate: (col: string) => `HLL_COUNT.MERGE_PARTIAL(${col})`,
  hllCardinality: (col: string) => `HLL_COUNT.EXTRACT(${col})`,
  quantileSketchInit: (col: string) =>
    `KLL_QUANTILES.INIT_FLOAT64(${col}, 1000)`,
  quantileSketchMergePartial: (col: string) =>
    `KLL_QUANTILES.MERGE_PARTIAL(${col})`,
  quantileSketchExtractPoint: (col: string, quantile: number) =>
    `KLL_QUANTILES.EXTRACT_POINT_FLOAT64(${col}, ${quantile})`,
  quantileSketchExtractQuantiles: (col: string, numQuantiles: number) =>
    `KLL_QUANTILES.EXTRACT_FLOAT64(${col}, ${numQuantiles})`,
  quantileSketchRankApprox: (
    sketchCol: string,
    thresholdCol: string,
    nEventsCol: string,
    numQuantiles: number,
  ) => {
    const cdfArray = bigQueryDialect.quantileSketchExtractQuantiles(
      sketchCol,
      numQuantiles,
    );
    const countBelow = `(SELECT COUNT(*) FROM UNNEST(${cdfArray}) AS p WHERE p < ${thresholdCol})`;
    return `COALESCE(${countBelow} * ${nEventsCol} / ${numQuantiles}.0, 0)`;
  },
  hasArrayQuantileGrid: () => true,
  // BigQuery rejects NULL containing arrays in a query result, so collapse the
  // whole grid to NULL when an array would contain NULLs.
  // The quantile-grid elements are all-or-nothing, so we can test the first element.
  quantileGridArrayLiteral: (elements: string[]) =>
    elements.length > 0
      ? `IF(${elements[0]} IS NULL, NULL, [${elements.join(", ")}])`
      : `[${elements.join(", ")}]`,
  percentileApprox: (value: string, quantile: string | number) => {
    const multiplier = APPROX_QUANTILES_MULTIPLIER;
    const quantileVal = Number(quantile)
      ? Math.trunc(multiplier * Number(quantile))
      : `${multiplier} * ${quantile}`;
    return `APPROX_QUANTILES(${value}, ${multiplier} IGNORE NULLS)[OFFSET(CAST(${quantileVal} AS INT64))]`;
  },
  jsonExtract: (jsonCol: string, path: string, isNumeric: boolean) => {
    const raw = `JSON_VALUE(${jsonCol}, '$.${path}')`;
    return isNumeric ? `CAST(${raw} AS FLOAT64)` : raw;
  },
  // BigQuery uses `IGNORE NULLS` in aggregates rather than `FILTER (WHERE …)`.
  arrayAggSorted: (col: string) =>
    `ARRAY_AGG(${col} IGNORE NULLS ORDER BY ${col})`,
  // BQ supports `ANY_VALUE(x HAVING MIN y)` natively — picks an `x` value from
  // the row that has the minimum `y`. `IGNORE NULLS` is NOT valid in this form
  // (syntax error) and is unnecessary: aggregate functions ignore NULL inputs,
  // so rows with a NULL timestamp are already excluded from the MIN.
  argMinByTimestamp: (valueCol: string, tsCol: string) =>
    `ANY_VALUE(${valueCol} HAVING MIN ${tsCol})`,
  arrayMinInRange: (col, lowerBound, upperBound) => {
    const conditions: string[] = [];
    if (lowerBound) conditions.push(`t >= ${lowerBound}`);
    if (upperBound) conditions.push(`t <= ${upperBound}`);
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    return `(SELECT MIN(t) FROM UNNEST(${col}) AS t ${where})`;
  },
  addIntervalSeconds: (col: string, sign: "+" | "-", amount: number) =>
    `DATETIME_${sign === "+" ? "ADD" : "SUB"}(${col}, INTERVAL ${amount} SECOND)`,
  dateDiffMs: (startCol: string, endCol: string) =>
    `CAST(DATETIME_DIFF(${endCol}, ${startCol}, MILLISECOND) AS FLOAT64)`,
  getDataType: (dataType: DataType): string => {
    switch (dataType) {
      case "string":
        return "STRING";
      case "integer":
        return "INT64";
      case "float":
        return "FLOAT64";
      case "boolean":
        return "BOOL";
      case "date":
        return "DATE";
      case "timestamp":
        return "TIMESTAMP";
      case "hll":
        return "BYTES";
      case "quantileSketch":
        return "BYTES";
      default: {
        const _: never = dataType;
        throw new Error(`Unsupported data type: ${dataType}`);
      }
    }
  },
  getCurrentTimestamp: () => `CURRENT_TIMESTAMP()`,
  percentileCapSelectClause: (values, metricTable, where = "") =>
    bigQueryPercentileCapSelectClause(values, metricTable, where),
  unpivotLabeledPairs: (pairs) => {
    const structs = pairs
      .map(
        (p) =>
          `STRUCT('${p.keyLiteral}' AS column_name, ${p.valueSql} AS value)`,
      )
      .join(", ");
    return {
      fromContinuation: `CROSS JOIN UNNEST([${structs}]) AS col`,
      keyExpr: "col.column_name",
      valueExpr: "col.value",
    };
  },
  arrayElement: (arrayCol: string, index: number) =>
    `${arrayCol}[SAFE_OFFSET(${index})]`,

  // APPROX_TOP_COUNT(expr, k) returns ARRAY<STRUCT<value, count>> per column;
  // pack the per-column structs into one array and double-UNNEST back to long
  // form. It counts NULLs, so disqualified values map to NULL and the NULL
  // bucket is dropped via `item.value IS NOT NULL`.
  approxTopValuesCTEBody: ({
    pairs,
    fromTable,
    whereClause,
    limit,
    maxValueLength,
  }) => {
    const structs = pairs
      .map(
        (p) =>
          `STRUCT('${p.keyLiteral}' AS column_name, APPROX_TOP_COUNT(${eligibleTopValueExpr(
            bigQueryDialect,
            p.valueSql,
            maxValueLength,
          )}, ${limit}) AS items)`,
      )
      .join(",\n      ");
    return `
  SELECT __col.column_name AS column_name, __item.value AS value, __item.count AS count
  FROM (
    SELECT [
      ${structs}
    ] AS cols
    FROM ${fromTable}
    WHERE ${whereClause}
  ) __agg
  CROSS JOIN UNNEST(__agg.cols) AS __col
  CROSS JOIN UNNEST(__col.items) AS __item
  WHERE __item.value IS NOT NULL`;
  },
};
