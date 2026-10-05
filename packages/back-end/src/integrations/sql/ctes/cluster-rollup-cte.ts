import {
  isLowerPercentileCappedMetric,
  isUpperPercentileCappedMetric,
} from "shared/experiments";
import type {
  DimensionColumnData,
  FactMetricData,
} from "shared/types/integrations";
import type { FactTableInterface } from "shared/types/fact-table";

/**
 * This CTE caps each sub-unit's value and sums them up to the cluster, producing
 * one row per (variation, dimension, cluster).
 */
export function getClusterRollupCTE({
  dimensionCols,
  metricData,
  baseIdType,
  clusterIdColumn,
  perUserAggTableName,
  capValueTableName,
  factTablesWithIndices,
  percentileTableIndices,
}: {
  dimensionCols: DimensionColumnData[];
  metricData: FactMetricData[];
  /** The sub-unit identifier (baseIdType of the per-sub-unit pipeline). */
  baseIdType: string;
  /** The cluster identifier column carried on source 0's per-sub-unit aggregate. */
  clusterIdColumn: string;
  /** Per-source per-sub-unit aggregate; source i is suffixed with `i` (0 is bare). */
  perUserAggTableName: string;
  capValueTableName: string;
  factTablesWithIndices: { factTable: FactTableInterface; index: number }[];
  percentileTableIndices: Set<number>;
}): string {
  return `SELECT
        m.variation AS variation
        ${dimensionCols.map((c) => `, m.${c.alias} AS ${c.alias}`).join("")}
        , m.${clusterIdColumn} AS ${clusterIdColumn}
        ${metricData
          .map((data) => {
            const numerator = `, SUM(${data.clusterRollupNumerator}) AS ${data.alias}_value`;
            const denominator =
              data.clusterRollupDenominator === null
                ? `, COUNT(DISTINCT m.${baseIdType}) AS ${data.alias}_denominator`
                : `, SUM(${data.clusterRollupDenominator}) AS ${data.alias}_denominator`;
            const covariate = data.regressionAdjusted
              ? `, SUM(${data.clusterRollupCovariateNumerator}) AS ${data.alias}_covariate_value\n            ${
                  data.clusterRollupCovariateDenominator === null
                    ? `, COUNT(DISTINCT m.${baseIdType}) AS ${data.alias}_covariate_denominator`
                    : `, SUM(${data.clusterRollupCovariateDenominator}) AS ${data.alias}_covariate_denominator`
                }`
              : "";
            const uncapped = data.computeUncappedMetric
              ? `, SUM(${data.clusterRollupNumeratorUncapped}) AS ${data.alias}_value_uncapped\n            ${
                  data.clusterRollupDenominatorUncapped === null
                    ? `, COUNT(DISTINCT m.${baseIdType}) AS ${data.alias}_denominator_uncapped`
                    : `, SUM(${data.clusterRollupDenominatorUncapped}) AS ${data.alias}_denominator_uncapped`
                }${
                  data.regressionAdjusted
                    ? `\n            , SUM(${data.clusterRollupCovariateNumeratorUncapped}) AS ${data.alias}_covariate_value_uncapped\n            ${
                        data.clusterRollupCovariateDenominatorUncapped === null
                          ? `, COUNT(DISTINCT m.${baseIdType}) AS ${data.alias}_covariate_denominator_uncapped`
                          : `, SUM(${data.clusterRollupCovariateDenominatorUncapped}) AS ${data.alias}_covariate_denominator_uncapped`
                      }`
                    : ""
                }`
              : "";
            const numSuffix =
              data.numeratorSourceIndex === 0 ? "" : data.numeratorSourceIndex;
            const denSuffix =
              data.denominatorSourceIndex === 0
                ? ""
                : data.denominatorSourceIndex;
            const upper = isUpperPercentileCappedMetric(data.metric);
            const lower = isLowerPercentileCappedMetric(data.metric);
            const hasDenominatorCap = data.clusterRollupDenominator !== null;
            const capCols = [
              upper
                ? `, MAX(cap${numSuffix}.${data.alias}_value_cap) AS ${data.alias}_value_cap`
                : "",
              lower
                ? `, MAX(cap${numSuffix}.${data.alias}_value_cap_lower) AS ${data.alias}_value_cap_lower`
                : "",
              hasDenominatorCap && upper
                ? `, MAX(cap${denSuffix}.${data.alias}_denominator_cap) AS ${data.alias}_denominator_cap`
                : "",
              hasDenominatorCap && lower
                ? `, MAX(cap${denSuffix}.${data.alias}_denominator_cap_lower) AS ${data.alias}_denominator_cap_lower`
                : "",
            ].join("");
            return `${numerator}\n            ${denominator}\n            ${covariate}\n            ${uncapped}\n            ${capCols}`;
          })
          .join("\n        ")}
      FROM
        ${perUserAggTableName} m
        ${factTablesWithIndices
          .map(({ index }) =>
            index === 0
              ? ""
              : `LEFT JOIN ${perUserAggTableName}${index} m${index} ON (
          m${index}.${baseIdType} = m.${baseIdType}
        )`,
          )
          .join("\n        ")}
        ${factTablesWithIndices
          .filter((f) => percentileTableIndices.has(f.index))
          .map((f) => {
            const suffix = `${f.index === 0 ? "" : f.index}`;
            return `CROSS JOIN ${capValueTableName}${suffix} cap${suffix}`;
          })
          .join("\n        ")}
      GROUP BY
        m.variation
        ${dimensionCols.map((c) => `, m.${c.alias}`).join("")}
        , m.${clusterIdColumn}`;
}
