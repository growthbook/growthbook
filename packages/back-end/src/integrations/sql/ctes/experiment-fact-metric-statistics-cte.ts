import {
  isLowerPercentileCappedMetric,
  isUpperPercentileCappedMetric,
  isFactFunnelMetric,
} from "shared/experiments";
import type {
  DimensionColumnData,
  FactMetricData,
  FactMetricQuantileData,
} from "shared/types/integrations";
import type { FactTableInterface } from "shared/types/fact-table";
import type { SqlDialect } from "shared/types/sql";
import { N_STAR_VALUES } from "back-end/src/services/experimentQueries/constants";

import { getQuantileGridColumns } from "back-end/src/integrations/sql/columns/quantile-grid-columns";
import {
  funnelStepSumColumn,
  funnelStepValueColumn,
} from "back-end/src/integrations/sql/fact-metrics/funnel-columns";

export function getExperimentFactMetricStatisticsCTE(
  dialect: SqlDialect,
  {
    dimensionCols,
    metricData,
    eventQuantileData,
    baseIdType,
    joinedMetricTableName,
    statisticsSourceTableName,
    flattenedSources = false,
    funnelsResolvedOnSource = false,
    eventQuantileTableName,
    capValueTableName,
    factTablesWithIndices,
    percentileTableIndices,
    isClusterExperiment = false,
  }: {
    dimensionCols: DimensionColumnData[];
    metricData: FactMetricData[];
    eventQuantileData: FactMetricQuantileData[];
    baseIdType: string;
    /** Per-source per-user aggregate; source i is suffixed with `i` (0 is bare). */
    joinedMetricTableName: string;
    /** Table read as `m`. Defaults to source 0's per-user aggregate. */
    statisticsSourceTableName?: string;
    /**
     * Set when the source table already carries every source's columns, so no
     * source needs joining a second time.
     */
    flattenedSources?: boolean;
    /** Set when the source table carries resolved funnel step values. */
    funnelsResolvedOnSource?: boolean;
    eventQuantileTableName: string;
    capValueTableName: string;
    factTablesWithIndices: { factTable: FactTableInterface; index: number }[];
    percentileTableIndices: Set<number>;
    isClusterExperiment?: boolean;
  },
): string {
  const useArrayQuantileGrid = dialect.hasArrayQuantileGrid();
  const sourceTableName = statisticsSourceTableName ?? joinedMetricTableName;
  // Funnel step values come from the resolution chain, not a per-source
  // aggregate.
  const hasFunnelMetrics = metricData.some((d) => isFactFunnelMetric(d.metric));
  if (hasFunnelMetrics && !funnelsResolvedOnSource) {
    throw new Error(
      "ImplementationError: funnel metrics require a resolved funnel table",
    );
  }
  return `SELECT
        m.variation AS variation
        ${dimensionCols.map((c) => `, m.${c.alias} AS ${c.alias}`).join("")}
        , COUNT(*) AS users
        ${metricData
          .map((data) => {
            // A funnel emits its own set of statistics
            if (isFactFunnelMetric(data.metric)) {
              return `
           , ${dialect.castToString(`'${data.id}'`)} as ${data.alias}_id
            ${data.metric.funnelSettings.steps
              .map(
                (step, stepIndex) => `-- ${step.name}
            , SUM(COALESCE(m.${funnelStepValueColumn(data.alias, stepIndex)}, 0)) AS ${funnelStepSumColumn(data.alias, stepIndex)}`,
              )
              .join("\n            ")}
          `;
            }

            //TODO test numerator suffix capping
            const numeratorSuffix = `${data.numeratorSourceIndex === 0 ? "" : data.numeratorSourceIndex}`;
            const denominatorCapSuffix = `${
              data.denominatorSourceIndex === 0
                ? ""
                : data.denominatorSourceIndex
            }`;
            const numeratorUpperPct = isUpperPercentileCappedMetric(
              data.metric,
            );
            const numeratorLowerPct = isLowerPercentileCappedMetric(
              data.metric,
            );
            const numeratorCapRef = (col: string): string =>
              isClusterExperiment
                ? `m.${data.alias}_${col}`
                : `cap${numeratorSuffix}.${data.alias}_${col}`;
            const denominatorCapRef = (col: string): string =>
              isClusterExperiment
                ? `m.${data.alias}_${col}`
                : `cap${denominatorCapSuffix}.${data.alias}_${col}`;
            const clusterRollupRef = (col: string): string =>
              dialect.castToFloat(`COALESCE(m.${data.alias}_${col}, 0)`);
            const capMain = isClusterExperiment
              ? clusterRollupRef("value")
              : data.capCoalesceMetric;
            const capDenominator = isClusterExperiment
              ? clusterRollupRef("denominator")
              : data.capCoalesceDenominator;
            const capCovariate = isClusterExperiment
              ? clusterRollupRef("covariate_value")
              : data.capCoalesceCovariate;
            const capDenominatorCovariate = isClusterExperiment
              ? clusterRollupRef("covariate_denominator")
              : data.capCoalesceDenominatorCovariate;
            const uncappedMain = isClusterExperiment
              ? clusterRollupRef("value_uncapped")
              : data.uncappedCoalesceMetric;
            const uncappedDenominator = isClusterExperiment
              ? clusterRollupRef("denominator_uncapped")
              : data.uncappedCoalesceDenominator;
            const uncappedCovariate = isClusterExperiment
              ? clusterRollupRef("covariate_value_uncapped")
              : data.uncappedCoalesceCovariate;
            const uncappedDenominatorCovariate = isClusterExperiment
              ? clusterRollupRef("covariate_denominator_uncapped")
              : data.uncappedCoalesceDenominatorCovariate;
            const numeratorPercentileCapCols = [
              numeratorUpperPct
                ? `
                    , MAX(COALESCE(${numeratorCapRef("value_cap")}, 0)) as ${data.alias}_main_cap_value`
                : "",
              numeratorLowerPct
                ? `
                    , MAX(COALESCE(${numeratorCapRef("value_cap_lower")}, 0)) as ${data.alias}_main_cap_value_lower`
                : "",
            ].join("");
            const ratioDenominatorPercentileCapCols =
              data.ratioMetric && !data.isClusterRatioConversion
                ? [
                    numeratorUpperPct
                      ? `
                    , MAX(COALESCE(${denominatorCapRef("denominator_cap")}, 0)) as ${data.alias}_denominator_cap_value`
                      : "",
                    numeratorLowerPct
                      ? `
                    , MAX(COALESCE(${denominatorCapRef("denominator_cap_lower")}, 0)) as ${data.alias}_denominator_cap_value_lower`
                      : "",
                  ].join("")
                : "";
            return `
           , ${dialect.castToString(`'${data.id}'`)} as ${data.alias}_id
            ${
              data.computeUncappedMetric
                ? `
                , SUM(${uncappedMain}) AS ${data.alias}_main_sum_uncapped 
                , SUM(POWER(${uncappedMain}, 2)) AS ${data.alias}_main_sum_squares_uncapped
                `
                : ""
            }${numeratorPercentileCapCols}
            , SUM(${capMain}) AS ${data.alias}_main_sum
            , SUM(POWER(${capMain}, 2)) AS ${data.alias}_main_sum_squares
            ${
              data.quantileMetric === "event"
                ? `
              , SUM(COALESCE(m.${data.alias}_n_events, 0)) AS ${
                data.alias
              }_denominator_sum
              , SUM(POWER(COALESCE(m.${data.alias}_n_events, 0), 2)) AS ${
                data.alias
              }_denominator_sum_squares
              , SUM(COALESCE(m.${data.alias}_n_events, 0) * ${capMain}) AS ${data.alias}_main_denominator_sum_product
              , SUM(COALESCE(m.${data.alias}_n_events, 0)) AS ${
                data.alias
              }_quantile_n
              , MAX(qm.${data.alias}_quantile) AS ${data.alias}_quantile
                ${
                  useArrayQuantileGrid
                    ? `, ANY_VALUE(qm.${data.alias}_quantile_grid) AS ${data.alias}_quantile_grid`
                    : N_STAR_VALUES.map(
                        (
                          n,
                        ) => `, MAX(qm.${data.alias}_quantile_lower_${n}) AS ${data.alias}_quantile_lower_${n}
                        , MAX(qm.${data.alias}_quantile_upper_${n}) AS ${data.alias}_quantile_upper_${n}`,
                      ).join("\n")
                }`
                : ""
            }
            ${
              data.quantileMetric === "unit"
                ? `${getQuantileGridColumns(
                    dialect,
                    data.metricQuantileSettings,
                    `${data.alias}_`,
                  )}
                  , COUNT(m.${data.alias}_value) AS ${data.alias}_quantile_n`
                : ""
            }
            ${
              data.ratioMetric
                ? `
                ${
                  data.computeUncappedMetric
                    ? `
                    , SUM(${uncappedDenominator}) AS ${data.alias}_denominator_sum_uncapped 
                    , SUM(POWER(${uncappedDenominator}, 2)) AS ${data.alias}_denominator_sum_squares_uncapped
                    , SUM(${uncappedMain} * ${uncappedDenominator}) AS ${data.alias}_main_denominator_sum_product_uncapped                    
                    `
                    : ""
                }${ratioDenominatorPercentileCapCols}
                , SUM(${capDenominator}) AS 
                  ${data.alias}_denominator_sum
                , SUM(POWER(${capDenominator}, 2)) AS 
                  ${data.alias}_denominator_sum_squares
                ${
                  data.regressionAdjusted
                    ? `
                  ${
                    data.computeUncappedMetric
                      ? `
                      , SUM(${uncappedCovariate}) AS ${data.alias}_covariate_sum_uncapped
                      , SUM(POWER(${uncappedCovariate}, 2)) AS ${data.alias}_covariate_sum_squares_uncapped
                      , SUM(${uncappedDenominatorCovariate}) AS ${data.alias}_denominator_pre_sum_uncapped 
                      , SUM(POWER(${uncappedDenominatorCovariate}, 2)) AS ${data.alias}_denominator_pre_sum_squares_uncapped
                      , SUM(${uncappedMain} * ${uncappedCovariate}) AS ${data.alias}_main_covariate_sum_product_uncapped
                      , SUM(${uncappedMain} * ${uncappedDenominatorCovariate}) AS ${data.alias}_main_post_denominator_pre_sum_product_uncapped
                      , SUM(${uncappedCovariate} * ${uncappedDenominator}) AS ${data.alias}_main_pre_denominator_post_sum_product_uncapped
                      , SUM(${uncappedCovariate} * ${uncappedDenominatorCovariate}) AS ${data.alias}_main_pre_denominator_pre_sum_product_uncapped
                      , SUM(${uncappedDenominator} * ${uncappedDenominatorCovariate}) AS ${data.alias}_denominator_post_denominator_pre_sum_product_uncapped`
                      : ""
                  }
                  , SUM(${capCovariate}) AS ${data.alias}_covariate_sum
                  , SUM(POWER(${capCovariate}, 2)) AS ${data.alias}_covariate_sum_squares
                  , SUM(${capDenominatorCovariate}) AS ${data.alias}_denominator_pre_sum
                  , SUM(POWER(${capDenominatorCovariate}, 2)) AS ${data.alias}_denominator_pre_sum_squares
                  , SUM(${capMain} * ${capDenominator}) AS ${data.alias}_main_denominator_sum_product
                  , SUM(${capMain} * ${capCovariate}) AS ${data.alias}_main_covariate_sum_product
                  , SUM(${capMain} * ${capDenominatorCovariate}) AS ${data.alias}_main_post_denominator_pre_sum_product
                  , SUM(${capCovariate} * ${capDenominator}) AS ${data.alias}_main_pre_denominator_post_sum_product
                  , SUM(${capCovariate} * ${capDenominatorCovariate}) AS ${data.alias}_main_pre_denominator_pre_sum_product
                  , SUM(${capDenominator} * ${capDenominatorCovariate}) AS ${data.alias}_denominator_post_denominator_pre_sum_product
                  `
                    : `
                    , SUM(${capDenominator} * ${capMain}) AS ${data.alias}_main_denominator_sum_product
                  `
                }` /*ends ifelse regressionAdjusted*/
                : ` 
              ${
                data.regressionAdjusted
                  ? `
                  ${
                    data.computeUncappedMetric
                      ? `
                      , SUM(${uncappedCovariate}) AS ${data.alias}_covariate_sum_uncapped
                      , SUM(POWER(${uncappedCovariate}, 2)) AS ${data.alias}_covariate_sum_squares_uncapped
                      , SUM(${uncappedMain} * ${uncappedCovariate}) AS ${data.alias}_main_covariate_sum_product_uncapped
                      `
                      : ""
                  }  
                , SUM(${capCovariate}) AS ${data.alias}_covariate_sum
                , SUM(POWER(${capCovariate}, 2)) AS ${data.alias}_covariate_sum_squares
                , SUM(${capMain} * ${capCovariate}) AS ${data.alias}_main_covariate_sum_product
                `
                  : ""
              }
            `
            }
          `; /*ends ifelse ratioMetric*/
          })
          .join("\n")}
      FROM
        ${sourceTableName} m
        ${
          // Event quantiles never span sources (enforced by the query builder)
          eventQuantileData.length
            ? `LEFT JOIN ${eventQuantileTableName} qm ON (
          qm.variation = m.variation 
          ${dimensionCols
            .map((c) => `AND qm.${c.alias} = m.${c.alias}`)
            .join("\n")}
            )`
            : ""
        }
      ${factTablesWithIndices
        .map(({ factTable: _, index }) => {
          const suffix = `${index === 0 ? "" : index}`;
          return `
        ${
          index === 0 || flattenedSources
            ? ""
            : `LEFT JOIN ${joinedMetricTableName}${suffix} m${suffix} ON (
          m${suffix}.${baseIdType} = m.${baseIdType}
        )`
        }
        ${
          percentileTableIndices.has(index) && !isClusterExperiment
            ? `
          CROSS JOIN ${capValueTableName}${suffix} cap${suffix}
        `
            : ""
        }
        `;
        })
        .join("\n")}
      GROUP BY
        m.variation
        ${dimensionCols.map((c) => `, m.${c.alias}`).join("")}
    `;
}
