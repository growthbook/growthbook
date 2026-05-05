import type {
  DimensionColumnData,
  FactMetricData,
  FactMetricQuantileData,
} from "shared/types/integrations";
import type { FactTableInterface } from "shared/types/fact-table";
import type { SqlDialect } from "shared/types/sql";
import { N_STAR_VALUES } from "back-end/src/services/experimentQueries/constants";

import { getQuantileGridColumns } from "back-end/src/integrations/sql/columns/quantile-grid-columns";

export function getExperimentFactMetricStatisticsCTE(
  dialect: SqlDialect,
  {
    dimensionCols,
    metricData,
    eventQuantileData,
    baseIdType,
    joinedMetricTableName,
    eventQuantileTableName,
    capValueTableName,
    factTablesWithIndices,
    percentileTableIndices,
  }: {
    dimensionCols: DimensionColumnData[];
    metricData: FactMetricData[];
    eventQuantileData: FactMetricQuantileData[];
    baseIdType: string;
    joinedMetricTableName: string;
    eventQuantileTableName: string;
    capValueTableName: string;
    factTablesWithIndices: { factTable: FactTableInterface; index: number }[];
    percentileTableIndices: Set<number>;
  },
): string {
  return `SELECT
        m.variation AS variation
        ${dimensionCols.map((c) => `, m.${c.alias} AS ${c.alias}`).join("")}
        , COUNT(*) AS users
        ${metricData
          .map((data) => {
            //TODO test numerator suffix capping
            const numeratorSuffix = `${data.numeratorSourceIndex === 0 ? "" : data.numeratorSourceIndex}`;
            return `
           , ${dialect.castToString(`'${data.id}'`)} as ${data.alias}_id
            ${
              data.computeUncappedMetric
                ? `
                , SUM(${data.uncappedCoalesceMetric}) AS ${data.alias}_main_sum_uncapped 
                , SUM(POWER(${data.uncappedCoalesceMetric}, 2)) AS ${data.alias}_main_sum_squares_uncapped
                ${
                  data.isPercentileCapped
                    ? `
                    , MAX(COALESCE(cap${numeratorSuffix}.${data.alias}_value_cap, 0)) as ${data.alias}_main_cap_value 
                    `
                    : ""
                }
                `
                : ""
            }
            , SUM(${data.capCoalesceMetric}) AS ${data.alias}_main_sum
            , SUM(POWER(${data.capCoalesceMetric}, 2)) AS ${
              data.alias
            }_main_sum_squares
            ${
              data.quantileMetric === "event"
                ? `
              , SUM(COALESCE(m.${data.alias}_n_events, 0)) AS ${
                data.alias
              }_denominator_sum
              , SUM(POWER(COALESCE(m.${data.alias}_n_events, 0), 2)) AS ${
                data.alias
              }_denominator_sum_squares
              , SUM(COALESCE(m.${data.alias}_n_events, 0) * ${
                data.capCoalesceMetric
              }) AS ${data.alias}_main_denominator_sum_product
              , SUM(COALESCE(m.${data.alias}_n_events, 0)) AS ${
                data.alias
              }_quantile_n
              , MAX(qm.${data.alias}_quantile) AS ${data.alias}_quantile
                ${N_STAR_VALUES.map(
                  (
                    n,
                  ) => `, MAX(qm.${data.alias}_quantile_lower_${n}) AS ${data.alias}_quantile_lower_${n}
                        , MAX(qm.${data.alias}_quantile_upper_${n}) AS ${data.alias}_quantile_upper_${n}`,
                ).join("\n")}`
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
                    , SUM(${data.uncappedCoalesceDenominator}) AS ${data.alias}_denominator_sum_uncapped 
                    , SUM(POWER(${data.uncappedCoalesceDenominator}, 2)) AS ${data.alias}_denominator_sum_squares_uncapped
                    , SUM(${data.uncappedCoalesceMetric} * ${data.uncappedCoalesceDenominator}) AS ${data.alias}_main_denominator_sum_product_uncapped                    
                    ${
                      data.isPercentileCapped
                        ? `
                    , MAX(COALESCE(cap${data.denominatorSourceIndex === 0 ? "" : data.denominatorSourceIndex}.${data.alias}_denominator_cap, 0)) as ${data.alias}_denominator_cap_value
                    `
                        : ""
                    }
                    `
                    : ""
                }
                , SUM(${data.capCoalesceDenominator}) AS 
                  ${data.alias}_denominator_sum
                , SUM(POWER(${data.capCoalesceDenominator}, 2)) AS 
                  ${data.alias}_denominator_sum_squares
                ${
                  data.regressionAdjusted
                    ? `
                  ${
                    data.computeUncappedMetric
                      ? `
                      , SUM(${data.uncappedCoalesceCovariate}) AS ${data.alias}_covariate_sum_uncapped
                      , SUM(POWER(${data.uncappedCoalesceCovariate}, 2)) AS ${data.alias}_covariate_sum_squares_uncapped
                      , SUM(${data.uncappedCoalesceDenominatorCovariate}) AS ${data.alias}_denominator_pre_sum_uncapped 
                      , SUM(POWER(${data.uncappedCoalesceDenominatorCovariate}, 2)) AS ${data.alias}_denominator_pre_sum_squares_uncapped
                      , SUM(${data.uncappedCoalesceMetric} * ${data.uncappedCoalesceCovariate}) AS ${data.alias}_main_covariate_sum_product_uncapped
                      , SUM(${data.uncappedCoalesceMetric} * ${data.uncappedCoalesceDenominatorCovariate}) AS ${data.alias}_main_post_denominator_pre_sum_product_uncapped
                      , SUM(${data.uncappedCoalesceCovariate} * ${data.uncappedCoalesceDenominator}) AS ${data.alias}_main_pre_denominator_post_sum_product_uncapped
                      , SUM(${data.uncappedCoalesceCovariate} * ${data.uncappedCoalesceDenominatorCovariate}) AS ${data.alias}_main_pre_denominator_pre_sum_product_uncapped
                      , SUM(${data.uncappedCoalesceDenominator} * ${data.uncappedCoalesceDenominatorCovariate}) AS ${data.alias}_denominator_post_denominator_pre_sum_product_uncapped`
                      : ""
                  }
                  , SUM(${data.capCoalesceCovariate}) AS ${data.alias}_covariate_sum
                  , SUM(POWER(${data.capCoalesceCovariate}, 2)) AS ${data.alias}_covariate_sum_squares
                  , SUM(${data.capCoalesceDenominatorCovariate}) AS ${data.alias}_denominator_pre_sum
                  , SUM(POWER(${data.capCoalesceDenominatorCovariate}, 2)) AS ${data.alias}_denominator_pre_sum_squares
                  , SUM(${data.capCoalesceMetric} * ${data.capCoalesceDenominator}) AS ${data.alias}_main_denominator_sum_product
                  , SUM(${data.capCoalesceMetric} * ${data.capCoalesceCovariate}) AS ${data.alias}_main_covariate_sum_product
                  , SUM(${data.capCoalesceMetric} * ${data.capCoalesceDenominatorCovariate}) AS ${data.alias}_main_post_denominator_pre_sum_product
                  , SUM(${data.capCoalesceCovariate} * ${data.capCoalesceDenominator}) AS ${data.alias}_main_pre_denominator_post_sum_product
                  , SUM(${data.capCoalesceCovariate} * ${data.capCoalesceDenominatorCovariate}) AS ${data.alias}_main_pre_denominator_pre_sum_product
                  , SUM(${data.capCoalesceDenominator} * ${data.capCoalesceDenominatorCovariate}) AS ${data.alias}_denominator_post_denominator_pre_sum_product
                  `
                    : `
                    , SUM(${data.capCoalesceDenominator} * ${data.capCoalesceMetric}) AS ${data.alias}_main_denominator_sum_product
                  `
                }` /*ends ifelse regressionAdjusted*/
                : ` 
              ${
                data.regressionAdjusted
                  ? `
                  ${
                    data.computeUncappedMetric
                      ? `
                      , SUM(${data.uncappedCoalesceCovariate}) AS ${data.alias}_covariate_sum_uncapped
                      , SUM(POWER(${data.uncappedCoalesceCovariate}, 2)) AS ${data.alias}_covariate_sum_squares_uncapped
                      , SUM(${data.uncappedCoalesceMetric} * ${data.uncappedCoalesceCovariate}) AS ${data.alias}_main_covariate_sum_product_uncapped
                      `
                      : ""
                  }  
                , SUM(${data.capCoalesceCovariate}) AS ${data.alias}_covariate_sum
                , SUM(POWER(${data.capCoalesceCovariate}, 2)) AS ${data.alias}_covariate_sum_squares
                , SUM(${data.capCoalesceMetric} * ${data.capCoalesceCovariate}) AS ${data.alias}_main_covariate_sum_product
                `
                  : ""
              }
            `
            }
          `; /*ends ifelse ratioMetric*/
          })
          .join("\n")}
      FROM
        ${joinedMetricTableName} m
        ${
          eventQuantileData.length // TODO(sql): error if event quantiles have two tables
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
          index === 0
            ? ""
            : `LEFT JOIN ${joinedMetricTableName}${suffix} m${suffix} ON (
          m${suffix}.${baseIdType} = m.${baseIdType}
        )`
        }
        ${
          percentileTableIndices.has(index)
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
