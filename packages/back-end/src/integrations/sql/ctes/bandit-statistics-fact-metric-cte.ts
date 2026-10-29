import { SqlDialect } from "shared/types/sql";
import type {
  BanditMetricData,
  DimensionColumnData,
} from "shared/types/integrations";
import type { FactTableInterface } from "shared/types/fact-table";
import { banditDimensionJoinCondition } from "back-end/src/integrations/sql/ctes/bandit-statistics-cte";

export function getBanditStatisticsFactMetricCTE(
  dialect: SqlDialect,
  {
    baseIdType,
    metricData,
    dimensionCols,
    factTablesWithIndices,
    regressionAdjustedTableIndices,
    percentileTableIndices,
  }: {
    baseIdType: string;
    metricData: BanditMetricData[];
    dimensionCols: DimensionColumnData[];
    factTablesWithIndices: { factTable: FactTableInterface; index: number }[];
    regressionAdjustedTableIndices: Set<number>;
    percentileTableIndices: Set<number>;
  },
): string {
  const renormalizedWeight = `bpw.weight / NULLIF(vwt.variation_weight_total, 0)`;
  return `
    -- One row per variation/dimension with aggregations
    , __banditPeriodStatistics AS (
      SELECT
        m.variation AS variation
        ${dimensionCols.map((d) => `, m.${d.alias} AS ${d.alias}`).join("")}
        , m.bandit_period AS bandit_period
        , ${dialect.castToFloat(`COUNT(*)`)} AS users
        ${metricData
          .map((data) => {
            const alias = data.alias + "_";
            const numeratorSourceSuffix =
              data.numeratorSourceIndex === 0 ? "" : data.numeratorSourceIndex;
            const denominatorSourceSuffix =
              data.denominatorSourceIndex === 0
                ? ""
                : data.denominatorSourceIndex;
            return `
          ${
            data.isUpperPercentileCapped
              ? `, MAX(COALESCE(cap${numeratorSourceSuffix}.${alias}value_cap, 0)) AS ${alias}main_cap_value`
              : ""
          }
          ${
            data.isLowerPercentileCapped
              ? `, MAX(COALESCE(cap${numeratorSourceSuffix}.${alias}value_cap_lower, 0)) AS ${alias}main_cap_value_lower`
              : ""
          }
          , ${dialect.castToFloat(
            `SUM(${data.capCoalesceMetric})`,
          )} AS ${alias}main_sum
          , ${dialect.castToFloat(
            `SUM(POWER(${data.capCoalesceMetric}, 2))`,
          )} AS ${alias}main_sum_squares
          ${
            data.ratioMetric
              ? `
            ${
              data.isUpperPercentileCapped
                ? `, MAX(COALESCE(cap${denominatorSourceSuffix}.${alias}denominator_cap, 0)) as ${alias}denominator_cap_value`
                : ""
            }
            ${
              data.isLowerPercentileCapped
                ? `, MAX(COALESCE(cap${denominatorSourceSuffix}.${alias}denominator_cap_lower, 0)) as ${alias}denominator_cap_value_lower`
                : ""
            }
            , ${dialect.castToFloat(
              `SUM(${data.capCoalesceDenominator})`,
            )} AS ${alias}denominator_sum
            , ${dialect.castToFloat(
              `SUM(POWER(${data.capCoalesceDenominator}, 2))`,
            )} AS ${alias}denominator_sum_squares
            , ${dialect.castToFloat(
              `SUM(${data.capCoalesceDenominator} * ${data.capCoalesceMetric})`,
            )} AS ${alias}main_denominator_sum_product
          `
              : ""
          }
          ${
            data.regressionAdjusted
              ? `
            , ${dialect.castToFloat(
              `SUM(${data.capCoalesceCovariate})`,
            )} AS ${alias}covariate_sum
            , ${dialect.castToFloat(
              `SUM(POWER(${data.capCoalesceCovariate}, 2))`,
            )} AS ${alias}covariate_sum_squares
            , ${dialect.castToFloat(
              `SUM(${data.capCoalesceMetric} * ${data.capCoalesceCovariate})`,
            )} AS ${alias}main_covariate_sum_product
            `
              : ""
          }`;
          })
          .join("\n")}
      FROM
        __userMetricAgg m
      ${factTablesWithIndices
        .map(({ factTable: _, index }) => {
          const suffix = `${index === 0 ? "" : index}`;
          return `
        ${
          index === 0
            ? ""
            : `LEFT JOIN __userMetricAgg${suffix} m${suffix} ON (
          m${suffix}.${baseIdType} = m.${baseIdType}
        )`
        }
        ${
          percentileTableIndices.has(index)
            ? `
          CROSS JOIN __capValue${suffix} cap${suffix}
        `
            : ""
        }
      `;
        })
        .join("\n")}
      GROUP BY
        m.variation
        , m.bandit_period
        ${dimensionCols.map((d) => `, m.${d.alias}`).join("")}
    ),
    __dimensionTotals AS (
      SELECT
        ${dialect.castToFloat(`SUM(users)`)} AS total_users
        ${dimensionCols.map((d) => `, ${d.alias} AS ${d.alias}`).join("\n")}
      FROM 
        __banditPeriodStatistics
      ${dimensionCols.length > 0 ? `GROUP BY ${dimensionCols.map((d) => `${d.alias}`).join(", ")}` : ""}
    ),
    __banditPeriodWeights AS (
      SELECT
        bps.bandit_period AS bandit_period
        ${dimensionCols.map((d) => `, bps.${d.alias} AS ${d.alias}`).join("")}
        , SUM(bps.users) / MAX(dt.total_users) AS weight
        ${metricData
          .map((data) => {
            const alias = data.alias + "_";
            return `
        ${
          data.regressionAdjusted
            ? `
            , ${dialect.ifElse(
              `(SUM(bps.users) - 1) <= 0`,
              "0",
              `(
                SUM(bps.${alias}covariate_sum_squares) - 
                POWER(SUM(bps.${alias}covariate_sum), 2) / SUM(bps.users)
              ) / (SUM(bps.users) - 1)`,
            )} AS ${alias}period_pre_variance
            , ${dialect.ifElse(
              `(SUM(bps.users) - 1) <= 0`,
              "0",
              `(
                SUM(bps.${alias}main_covariate_sum_product) - 
                SUM(bps.${alias}covariate_sum) * SUM(bps.${alias}main_sum) / SUM(bps.users)
              ) / (SUM(bps.users) - 1)`,
            )} AS ${alias}period_covariance
          `
            : ""
        }`;
          })
          .join("\n")}
      FROM 
        __banditPeriodStatistics bps
      LEFT JOIN __dimensionTotals dt ON (
        ${banditDimensionJoinCondition("bps", "dt", dimensionCols)}
      )
      GROUP BY
        bps.bandit_period
        ${dimensionCols.map((d) => `, bps.${d.alias}`).join("\n")}
    )
    ${
      regressionAdjustedTableIndices.size > 0
        ? `
        , __theta AS (
        SELECT
          ${dimensionCols.map((d) => `${d.alias} AS ${d.alias}`).join(", ")}
        ${metricData
          .map((data) => {
            const alias = data.alias + "_";
            return `
        ${
          data.regressionAdjusted
            ? `

            , ${dialect.ifElse(
              `SUM(POWER(weight, 2) * ${alias}period_pre_variance) <= 0`,
              "0",
              `SUM(POWER(weight, 2) * ${alias}period_covariance) / 
            SUM(POWER(weight, 2) * ${alias}period_pre_variance)`,
            )} AS ${alias}theta
          `
            : ""
        }`;
          })
          .join("\n")}
        FROM
          __banditPeriodWeights
        ${dimensionCols.length > 0 ? `GROUP BY ${dimensionCols.map((d) => `${d.alias}`).join(", ")}` : ""}
        )
      `
        : ""
    }
    , __variationEligiblePeriods AS (
      -- Periods a variation received traffic in across ANY context. Used to distinguish between variations that received no traffic in a period and variations added mid-bandit.
      SELECT DISTINCT
        variation
        , bandit_period
      FROM
        __banditPeriodStatistics
    )
    , __variationPeriodWeightTotals AS (
      -- Per-variation sum of the shared period weights over the periods the
      -- variation was eligible in, per dimension.
      SELECT
        vep.variation AS variation
        ${dimensionCols.map((d) => `, bpw.${d.alias} AS ${d.alias}`).join("")}
        , SUM(bpw.weight) AS variation_weight_total
      FROM
        __variationEligiblePeriods vep
      JOIN __banditPeriodWeights bpw ON (
        bpw.bandit_period = vep.bandit_period
      )
      GROUP BY
        vep.variation
        ${dimensionCols.map((d) => `, bpw.${d.alias}`).join("")}
    )
    , __variationPooledStats AS (
      -- Per-variation pooled (across-period) sample variance/covariance. Used to impute missing variances in periods with fewer than 2 users.
      SELECT
        variation AS variation
        ${dimensionCols.map((d) => `, ${d.alias} AS ${d.alias}`).join("")}
        ${metricData
          .map((data) => {
            const alias = data.alias + "_";
            return `
        , ${dialect.ifElse(
          "SUM(users) <= 1",
          "0",
          `(SUM(${alias}main_sum_squares) - POWER(SUM(${alias}main_sum), 2) / SUM(users)) / (SUM(users) - 1)`,
        )} AS ${alias}pooled_main_variance
        ${
          data.ratioMetric
            ? `
        , ${dialect.ifElse(
          "SUM(users) <= 1",
          "0",
          `(SUM(${alias}denominator_sum_squares) - POWER(SUM(${alias}denominator_sum), 2) / SUM(users)) / (SUM(users) - 1)`,
        )} AS ${alias}pooled_denominator_variance
        , ${dialect.ifElse(
          "SUM(users) <= 1",
          "0",
          `(SUM(${alias}main_denominator_sum_product) - SUM(${alias}main_sum) * SUM(${alias}denominator_sum) / SUM(users)) / (SUM(users) - 1)`,
        )} AS ${alias}pooled_main_denominator_covariance`
            : ""
        }
        ${
          data.regressionAdjusted
            ? `
        , ${dialect.ifElse(
          "SUM(users) <= 1",
          "0",
          `(SUM(${alias}covariate_sum_squares) - POWER(SUM(${alias}covariate_sum), 2) / SUM(users)) / (SUM(users) - 1)`,
        )} AS ${alias}pooled_covariate_variance
        , ${dialect.ifElse(
          "SUM(users) <= 1",
          "0",
          `(SUM(${alias}main_covariate_sum_product) - SUM(${alias}main_sum) * SUM(${alias}covariate_sum) / SUM(users)) / (SUM(users) - 1)`,
        )} AS ${alias}pooled_main_covariate_covariance`
            : ""
        }`;
          })
          .join("\n")}
      FROM
        __banditPeriodStatistics
      GROUP BY
        variation
        ${dimensionCols.map((d) => `, ${d.alias}`).join("")}
    )
    SELECT
      bps.variation
      ${dimensionCols.map((d) => `, bps.${d.alias} AS ${d.alias}`).join("")}
      , SUM(bps.users) AS users
      ${metricData
        .map((data) => {
          const alias = data.alias + "_";
          // Context-specific mean imputation for (period, variation, context) rows with no users.
          // the renormalized weight is variation-specific, using the period weights only for the variation's observed periods.
          const renorm = `(${renormalizedWeight})`;
          const imputedMean = (sumCol: string) =>
            `(SUM(${renorm} * bps.${sumCol} / bps.users) + SUM(bps.${sumCol}) / NULLIF(SUM(bps.users), 0) * (1 - SUM(${renorm})))`;
          const imputedMainMean = imputedMean(`${alias}main_sum`);
          const imputedDenominatorMean = imputedMean(`${alias}denominator_sum`);
          const imputedCovariateMean = imputedMean(`${alias}covariate_sum`);
          return `
      , ${dialect.castToString(`'${data.id}'`)} as ${alias}id
      , ${imputedMainMean} * SUM(bps.users) AS ${alias}main_sum
      , SUM(bps.users) * (SUM(
        ${dialect.ifElse(
          "bps.users <= 1",
          `POWER((${renormalizedWeight}), 2) * vps.${alias}pooled_main_variance / bps.users`,
          `POWER((${renormalizedWeight}), 2) * ((
          bps.${alias}main_sum_squares - POWER(bps.${alias}main_sum, 2) / bps.users
        ) / (bps.users - 1)) / bps.users
      `,
        )}) * (SUM(bps.users) - 1) + POWER(${imputedMainMean}, 2)) as ${alias}main_sum_squares
      ${
        data.ratioMetric
          ? `
        , ${imputedDenominatorMean} * SUM(bps.users) AS ${alias}denominator_sum
        , SUM(bps.users) * (SUM(
        ${dialect.ifElse(
          "bps.users <= 1",
          `POWER((${renormalizedWeight}), 2) * vps.${alias}pooled_denominator_variance / bps.users`,
          `POWER((${renormalizedWeight}), 2) * ((
            (bps.${alias}denominator_sum_squares - POWER(bps.${alias}denominator_sum, 2) / bps.users) / (bps.users - 1))
          ) / bps.users
        `,
        )}) * (SUM(bps.users) - 1) + POWER(
          ${imputedDenominatorMean}, 2)
        ) AS ${alias}denominator_sum_squares
        , SUM(bps.users) * (
            (SUM(bps.users) - 1) * SUM(
              ${dialect.ifElse(
                "bps.users <= 1",
                `POWER((${renormalizedWeight}), 2) * vps.${alias}pooled_main_denominator_covariance / bps.users`,
                `
              POWER((${renormalizedWeight}), 2) / (bps.users * (bps.users - 1)) * (
                bps.${alias}main_denominator_sum_product - bps.${alias}main_sum * bps.${alias}denominator_sum / bps.users
              )
            `,
              )}) +
            (
              ${imputedMainMean} * ${imputedDenominatorMean}
            )
          ) AS ${alias}main_denominator_sum_product`
          : ""
      }
      ${
        data.regressionAdjusted
          ? `
        , ${imputedCovariateMean} * SUM(bps.users) AS ${alias}covariate_sum
        , SUM(bps.users) * (SUM(
        ${dialect.ifElse(
          "bps.users <= 1",
          `POWER((${renormalizedWeight}), 2) * vps.${alias}pooled_covariate_variance / bps.users`,
          `POWER((${renormalizedWeight}), 2) * ((
            (bps.${alias}covariate_sum_squares - POWER(bps.${alias}covariate_sum, 2) / bps.users) / (bps.users - 1))
          ) / bps.users
        `,
        )}) * (SUM(bps.users) - 1) + POWER(${imputedCovariateMean}, 2)) AS ${alias}covariate_sum_squares
        , SUM(bps.users) * (
            (SUM(bps.users) - 1) * SUM(
              ${dialect.ifElse(
                "bps.users <= 1",
                `POWER((${renormalizedWeight}), 2) * vps.${alias}pooled_main_covariate_covariance / bps.users`,
                `
              POWER((${renormalizedWeight}), 2) / (bps.users * (bps.users - 1)) * (
                bps.${alias}main_covariate_sum_product - bps.${alias}main_sum * bps.${alias}covariate_sum / bps.users
              )
            `,
              )}) +
            (
              ${imputedMainMean} * ${imputedCovariateMean}
            )
          ) AS ${alias}main_covariate_sum_product
        , MAX(t.${alias}theta) AS ${alias}theta
          `
          : ""
      }`;
        })
        .join("\n")}
    FROM 
      __banditPeriodStatistics bps
    LEFT JOIN
      __banditPeriodWeights bpw
      ON (
        bps.bandit_period = bpw.bandit_period
        ${
          dimensionCols.length
            ? dimensionCols
                .map((d) => `AND bps.${d.alias} = bpw.${d.alias}`)
                .join("\n")
            : ""
        }
      )
    LEFT JOIN
      __variationPeriodWeightTotals vwt
      ON (
        bps.variation = vwt.variation
        ${
          dimensionCols.length
            ? dimensionCols
                .map((d) => `AND bps.${d.alias} = vwt.${d.alias}`)
                .join("\n")
            : ""
        }
      )
    LEFT JOIN
      __variationPooledStats vps
      ON (
        bps.variation = vps.variation
        ${
          dimensionCols.length
            ? dimensionCols
                .map((d) => `AND bps.${d.alias} = vps.${d.alias}`)
                .join("\n")
            : ""
        }
      )
    ${
      regressionAdjustedTableIndices.size > 0
        ? `
      LEFT JOIN
        __theta t
        ON (${banditDimensionJoinCondition("bps", "t", dimensionCols)})
      `
        : ""
    }
    GROUP BY
      bps.variation
      ${dimensionCols.map((d) => `, bps.${d.alias}`).join("")}
    `;
}
