import {
  getAggregateFilters,
  isBinomialMetric,
  quantileMetricType,
} from "shared/experiments";
import type { FactMetricAggregationMetadata } from "shared/types/integrations";
import type { FactMetricInterface } from "shared/types/fact-table";
import type { SqlDialect } from "shared/types/sql";

import { castToHllDataType } from "back-end/src/integrations/sql/primitives/cast-to-hll-data-type";

// Whether daily partials can be merged into a per-user covariate value.
// Event-quantile metrics store KLL sketches that can't recover a per-user value
// by merging, so the covariate read must fall back to a raw scan for them.
export function canReAggregateDailyPartialsForCovariate(
  metric: FactMetricInterface,
): boolean {
  return quantileMetricType(metric) !== "event";
}

export function getAggregationMetadata(
  dialect: SqlDialect,
  {
    metric,
    useDenominator,
  }: {
    metric: FactMetricInterface;
    useDenominator: boolean;
  },
): FactMetricAggregationMetadata {
  const columnRef = useDenominator ? metric.denominator : metric.numerator;

  const hasAggregateFilter =
    getAggregateFilters({
      columnRef: columnRef,
      column: columnRef?.column || "",
      ignoreInvalid: true,
    }).length > 0;

  const column = hasAggregateFilter
    ? columnRef?.aggregateFilterColumn
    : columnRef?.column;

  const nullIfZero =
    metric.quantileSettings?.ignoreZeros &&
    metric.quantileSettings?.type === "unit";

  if (
    !hasAggregateFilter &&
    (isBinomialMetric(metric) || column === "$$distinctUsers")
  ) {
    return {
      intermediateDataType: "integer",
      partialAggregationFunction: (column: string) =>
        `COALESCE(MAX(${column}), 0)`,
      finalDataType: "integer",
      reAggregationFunction: (column: string) => `COALESCE(MAX(${column}), 0)`,
      fullAggregationFunction: (column: string) =>
        `COALESCE(MAX(${column}), 0)`,
    };
  }

  const binomialWithAggregateFilter =
    hasAggregateFilter && isBinomialMetric(metric);
  const userCountWithAggregateFilter =
    hasAggregateFilter && column === "$$distinctUsers";
  if (binomialWithAggregateFilter || userCountWithAggregateFilter) {
    return {
      intermediateDataType: "integer",
      partialAggregationFunction: (column: string) =>
        `SUM(COALESCE((${column}), 0))`,
      finalDataType: "integer",
      reAggregationFunction: (column: string) =>
        `SUM(COALESCE((${column}), 0))`,
      fullAggregationFunction: (column: string) =>
        `SUM(COALESCE((${column}), 0))`,
    };
  }

  if (column === "$$count") {
    const reAggregationFunction = nullIfZero
      ? (column: string) => `NULLIF(SUM(COALESCE(${column}, 0)), 0)`
      : (column: string) => `SUM(COALESCE(${column}, 0))`;
    const fullAggregationFunction = nullIfZero
      ? (column: string) => `NULLIF(COUNT(${column}), 0)`
      : (column: string) => `COUNT(${column})`;
    return {
      intermediateDataType: "integer",
      partialAggregationFunction: (column: string) => `COUNT(${column})`,
      finalDataType: "integer",
      reAggregationFunction,
      fullAggregationFunction,
    };
  }

  if (column === "$$distinctDates") {
    const reAggregationFunction = nullIfZero
      ? (column: string) => `NULLIF(COUNT(DISTINCT ${column}), 0)`
      : (column: string) => `COUNT(DISTINCT ${column})`;
    const fullAggregationFunction = nullIfZero
      ? (column: string) => `NULLIF(COUNT(DISTINCT ${column}), 0)`
      : (column: string) => `COUNT(DISTINCT ${column})`;

    return {
      intermediateDataType: "date",
      partialAggregationFunction: (column: string) =>
        dialect.castToDate(`MAX(${column})`),
      finalDataType: "integer",
      reAggregationFunction,
      fullAggregationFunction,
    };
  }

  if (
    !columnRef?.column.startsWith("$$") &&
    columnRef?.aggregation === "count distinct"
  ) {
    const reAggregationFunction = nullIfZero
      ? (column: string) =>
          `NULLIF(${dialect.hllCardinality(dialect.hllReaggregate(column))}, 0)`
      : (column: string) =>
          dialect.hllCardinality(dialect.hllReaggregate(column));
    const fullAggregationFunction = nullIfZero
      ? (column: string) =>
          `NULLIF(${dialect.hllCardinality(dialect.hllAggregate(column))}, 0)`
      : (column: string) =>
          dialect.hllCardinality(dialect.hllAggregate(column));
    return {
      intermediateDataType: "hll",
      partialAggregationFunction: (column: string) =>
        castToHllDataType(dialect, dialect.hllAggregate(column)),
      finalDataType: "integer",
      reAggregationFunction,
      fullAggregationFunction,
    };
  }

  if (!columnRef?.column.startsWith("$$") && columnRef?.aggregation === "max") {
    return {
      intermediateDataType: "float",
      partialAggregationFunction: (column: string) =>
        `COALESCE(MAX(${column}), 0)`,
      reAggregationFunction: (column: string) => `COALESCE(MAX(${column}), 0)`,
      finalDataType: "float",
      fullAggregationFunction: (column: string) =>
        `COALESCE(MAX(${column}), 0)`,
    };
  }

  // "hll merge": the column is a pre-built HLL sketch (BYTES). Identical to
  // "count distinct" except the first aggregation step merges existing sketches
  // (hllReaggregate) rather than building one from raw values (hllAggregate).
  if (
    !columnRef?.column.startsWith("$$") &&
    columnRef?.aggregation === "hll merge"
  ) {
    const reAggregationFunction = nullIfZero
      ? (column: string) =>
          `NULLIF(${dialect.hllCardinality(dialect.hllReaggregate(column))}, 0)`
      : (column: string) =>
          dialect.hllCardinality(dialect.hllReaggregate(column));
    return {
      intermediateDataType: "hll",
      partialAggregationFunction: (column: string) =>
        castToHllDataType(dialect, dialect.hllReaggregate(column)),
      finalDataType: "integer",
      reAggregationFunction,
      // Full aggregation also starts from sketches, so reuse the re-agg path.
      fullAggregationFunction: reAggregationFunction,
    };
  }

  if (metric.metricType === "quantile") {
    if (!metric.quantileSettings) {
      throw new Error(
        `Quantile metric '${metric.id}' is missing quantileSettings.`,
      );
    }

    if (metric.quantileSettings.type === "event") {
      // "kll merge": the column is a pre-built quantile sketch (BYTES/OBJECT).
      // Only valid for event-quantile metrics. Identical to the event-quantile
      // branch below except the first aggregation step merges existing sketches
      // (quantileSketchMergePartial) rather than building one from raw numeric
      // values (quantileSketchInit). The fullAggregationFunction is unused for
      // "kll merge" because the non-incremental per-user path never sees raw
      // event values — only sketches.
      if (
        !columnRef?.column.startsWith("$$") &&
        columnRef?.aggregation === "kll merge"
      ) {
        return {
          intermediateDataType: "quantileSketch",
          partialAggregationFunction: (column: string) =>
            dialect.quantileSketchMergePartial(column),
          reAggregationFunction: (column: string) =>
            dialect.quantileSketchMergePartial(column),
          finalDataType: "integer",
          fullAggregationFunction: (column: string, quantileColumn?: string) =>
            `SUM(${dialect.ifElse(`${column} <= ${quantileColumn ?? ""}`, "1", "0")})`,
        };
      }
      // For incremental refresh, event quantile metrics store a quantile sketch
      // of event values per user-date. Sketches are merged (per user, then per
      // variation) at stats-query time and the quantile grid is extracted via
      // quantileSketchExtractPoint. The per-user "count below threshold"
      // (main_sum) is recovered via two-pass rank recovery
      // (quantileSketchRankApprox) — see getIncrementalRefreshStatisticsQuery.
      return {
        intermediateDataType: "quantileSketch",
        partialAggregationFunction: (column: string) =>
          dialect.quantileSketchInit(column),
        reAggregationFunction: (column: string) =>
          dialect.quantileSketchMergePartial(column),
        finalDataType: "integer",
        fullAggregationFunction: (column: string, quantileColumn?: string) =>
          `SUM(${dialect.ifElse(`${column} <= ${quantileColumn ?? ""}`, "1", "0")})`,
      };
    }

    // Unit quantiles are handled however the unit aggregation is specified and the quantile
    // is applied AFTER the `fullAggregationFunction` in the stats step.
  }

  const reAggregationFunction = nullIfZero
    ? (column: string) => `NULLIF(SUM(COALESCE(${column}, 0)), 0)`
    : (column: string) => `SUM(COALESCE(${column}, 0))`;
  const fullAggregationFunction = nullIfZero
    ? (column: string) => `NULLIF(SUM(COALESCE(${column}, 0)), 0)`
    : (column: string) => `SUM(COALESCE(${column}, 0))`;
  return {
    intermediateDataType: "float",
    partialAggregationFunction: (column: string) =>
      `SUM(COALESCE(${column}, 0))`,
    finalDataType: "float",
    reAggregationFunction,
    fullAggregationFunction,
  };
}
