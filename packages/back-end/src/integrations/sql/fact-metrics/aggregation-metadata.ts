import { getAggregateFilters, isBinomialMetric } from "shared/experiments";
import type { FactMetricAggregationMetadata } from "shared/types/integrations";
import type { FactMetricInterface } from "shared/types/fact-table";
import type { SqlDialect } from "shared/types/sql";

import { castToHllDataType } from "back-end/src/integrations/sql/primitives/cast-to-hll-data-type";

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

  if (
    metric.metricType === "quantile" &&
    metric.quantileSettings?.type === "event"
  ) {
    // For incremental refresh, event quantile metrics store a KLL sketch of
    // event values per user-date. Sketches are merged (per user, then per
    // variation) at stats-query time and the quantile grid is extracted via
    // kllExtractPoint. The per-user "count below threshold" (main_sum) is
    // recovered via two-pass rank recovery (kllRankApprox) — see
    // getIncrementalRefreshStatisticsQuery.
    return {
      intermediateDataType: "kll",
      partialAggregationFunction: (column: string) => dialect.kllInit(column),
      reAggregationFunction: (column: string) =>
        dialect.kllMergePartial(column),
      finalDataType: "integer",
      fullAggregationFunction: (column: string, quantileColumn?: string) =>
        `SUM(${dialect.ifElse(`${column} <= ${quantileColumn ?? ""}`, "1", "0")})`,
    };
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
