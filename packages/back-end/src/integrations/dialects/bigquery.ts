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
 * BigQuery-specific __capValue body: reshape value columns to long form via a
 * labeled UNNEST, compute one APPROX_QUANTILES sketch per group with GROUP BY,
 * then extract each requested percentile from its group's sketch back into the
 * wide one-row shape downstream expects.
 *
 * The default wide form emits one APPROX_QUANTILES per capped column in a single
 * ungrouped SELECT. Each sketch carries ~1.5MB of intermediate state at ~40M input
 * rows, so with ~65+ capped columns the single aggregation row exceeds BigQuery's
 * 100MB-per-row limit. chunkMetrics() doesn't see this because it budgets by
 * output-column count, not intermediate sketch state.
 *
 * Reshaping to GROUP BY keeps exactly one sketch per aggregation row, so the
 * per-row footprint is constant regardless of how many capped columns there are.
 *
 * A single source column can require MORE THAN ONE cap: a metric with percentile
 * capping on both tails contributes an upper `_cap` and a lower `_cap_lower` for
 * the same `valueCol` at different percentiles, and those two tails can even have
 * different `ignoreZeros`. So we can't key the reshape on the raw column name —
 * emitting the column once per cap (the older UNPIVOT form) produced duplicate
 * projected/UNPIVOT columns and a "Column name ... is ambiguous" BigQuery error.
 * Instead we group inputs into one sketch per distinct (valueCol, ignoreZeros)
 * pair under a synthetic label, keep each group's full quantile array, and index
 * it at every requested percentile's offset.
 */
function bigQueryPercentileCapSelectClause(
  values: PercentileCapSelectClauseValue[],
  metricTable: string,
  where: string = "",
): string {
  // Below the threshold: the wide single-pass form is faster on both wall and
  // slot time (one scan of metricTable, no UNNEST row multiplication, no
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

  const escape = (s: string) => bigQueryDialect.escapeStringLiteral(s);
  const groupKey = (valueCol: string, ignoreZeros: boolean) =>
    `${valueCol}\u0000${ignoreZeros ? 1 : 0}`;

  // One sketch per distinct (valueCol, ignoreZeros) pair. Each pair gets a
  // stable synthetic label so two caps sharing a source column never collide.
  const labelByGroup = new Map<string, string>();
  const groups: { label: string; valueCol: string; ignoreZeros: boolean }[] =
    [];
  for (const { valueCol, ignoreZeros } of values) {
    const key = groupKey(valueCol, ignoreZeros);
    if (!labelByGroup.has(key)) {
      const label = `s${groups.length}`;
      labelByGroup.set(key, label);
      groups.push({ label, valueCol, ignoreZeros });
    }
  }

  // One labeled STRUCT per sketch group; cast to FLOAT64 for a uniform type and
  // bake `ignoreZeros` into the value so zeros drop out of that group's sketch.
  const structs = groups
    .map(({ label, valueCol, ignoreZeros }) => {
      const cast = `CAST(${valueCol} AS FLOAT64)`;
      const val = ignoreZeros ? `IF(${valueCol} = 0, NULL, ${cast})` : cast;
      return `STRUCT('${escape(label)}' AS col_name, ${val} AS val)`;
    })
    .join(", ");

  // Each requested cap extracts its percentile offset from its group's sketch.
  const outputs = values
    .map(({ valueCol, outputCol, percentile, ignoreZeros }) => {
      const label = labelByGroup.get(groupKey(valueCol, ignoreZeros))!;
      const offset = Math.trunc(APPROX_QUANTILES_MULTIPLIER * percentile);
      return `MAX(IF(col_name = '${escape(
        label,
      )}', q[OFFSET(${offset})], NULL)) AS ${outputCol}`;
    })
    .join(",\n        ");

  return `
      SELECT
        ${outputs}
      FROM (
        SELECT
          pair.col_name AS col_name,
          APPROX_QUANTILES(pair.val, ${APPROX_QUANTILES_MULTIPLIER} IGNORE NULLS) AS q
        FROM ${metricTable}
        CROSS JOIN UNNEST([${structs}]) AS pair
        ${where}
        GROUP BY pair.col_name
      )
      `;
}

const bigQueryEscapeStringLiteral = (value: string) =>
  value.replace(/(['\\])/g, "\\$1");

export const bigQueryDialect: SqlDialect = {
  ...baseDialect,
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
