import { SqlDialect } from "shared/types/sql";
import type {
  BanditMetricData,
  DimensionColumnData,
} from "shared/types/integrations";

export function getBanditStatisticsCTE(
  dialect: SqlDialect,
  {
    baseIdType,
    metricData,
    dimensionCols,
    hasRegressionAdjustment,
    hasCapping,
    ignoreNulls,
    denominatorIsPercentileCapped,
  }: {
    baseIdType: string;
    metricData: BanditMetricData[];
    dimensionCols: DimensionColumnData[];
    hasRegressionAdjustment: boolean;
    hasCapping: boolean;
    ignoreNulls?: boolean;
    denominatorIsPercentileCapped?: boolean;
  },
): string {
  return `-- One row per variation/dimension with aggregations
  , __banditPeriodStatistics AS (
    SELECT
      m.variation AS variation
      ${dimensionCols.map((d) => `, m.${d.alias} AS ${d.alias}`).join("")}
      , m.bandit_period AS bandit_period
      , ${dialect.castToFloat(`COUNT(*)`)} AS users
      ${metricData
        .map((data) => {
          const alias = data.alias;
          return `
        ${
          data.isPercentileCapped
            ? `, MAX(COALESCE(cap.${alias}value_cap, 0)) AS ${alias}main_cap_value`
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
            denominatorIsPercentileCapped
              ? `, MAX(COALESCE(capd.${alias}value_cap, 0)) as ${alias}denominator_cap_value`
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
    ${
      metricData[0]?.ratioMetric
        ? `LEFT JOIN __userDenominatorAgg d ON (
            d.${baseIdType} = m.${baseIdType}
          )
          ${
            denominatorIsPercentileCapped
              ? "CROSS JOIN __capValueDenominator capd"
              : ""
          }`
        : ""
    }
    ${
      hasRegressionAdjustment
        ? `
        LEFT JOIN __userCovariateMetric c
        ON (c.${baseIdType} = m.${baseIdType})
        `
        : ""
    }
    ${hasCapping ? `CROSS JOIN __capValue cap` : ""}
    ${ignoreNulls ? `WHERE m.value != 0` : ""}
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
    GROUP BY
      ${dimensionCols.map((d) => `${d.alias}`).join(", ")}
  ),
  __banditPeriodWeights AS (
    SELECT
      bps.bandit_period AS bandit_period
      ${dimensionCols.map((d) => `, bps.${d.alias} AS ${d.alias}`).join("")}
      , SUM(bps.users) / MAX(dt.total_users) AS weight
      ${metricData
        .map((data) => {
          const alias = data.alias;
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
    LEFT JOIN __dimensionTotals dt ON
      (${dimensionCols
        .map((d) => `bps.${d.alias} = dt.${d.alias}`)
        .join(" AND ")})
    GROUP BY
      bps.bandit_period
      ${dimensionCols.map((d) => `, bps.${d.alias}`).join("\n")}
  )
  ${
    hasRegressionAdjustment
      ? `
      , __theta AS (
      SELECT
        ${dimensionCols.map((d) => `${d.alias} AS ${d.alias}`).join(", ")}
      ${metricData
        .map((data) => {
          const alias = data.alias;
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
      GROUP BY
        ${dimensionCols.map((d) => `${d.alias}`).join(", ")}  
      )
    `
      : ""
  }
  SELECT
    bps.variation
    ${dimensionCols.map((d) => `, bps.${d.alias} AS ${d.alias}`).join("")}
    , SUM(bps.users) AS users
    ${metricData
      .map((data) => {
        const alias = data.alias;
        return `
    , ${dialect.castToString(`'${data.id}'`)} as ${alias}id
    , SUM(bpw.weight * bps.${alias}main_sum / bps.users) * SUM(bps.users) AS ${alias}main_sum
    , SUM(bps.users) * (SUM(
      ${dialect.ifElse(
        "bps.users <= 1",
        "0",
        `POWER(bpw.weight, 2) * ((
        bps.${alias}main_sum_squares - POWER(bps.${alias}main_sum, 2) / bps.users
      ) / (bps.users - 1)) / bps.users
    `,
      )}) * (SUM(bps.users) - 1) + POWER(SUM(bpw.weight * bps.${alias}main_sum / bps.users), 2)) as ${alias}main_sum_squares
    ${
      data.ratioMetric
        ? `
      , SUM(bpw.weight * bps.${alias}denominator_sum / bps.users) * SUM(bps.users) AS ${alias}denominator_sum
      , SUM(bps.users) * (SUM(
      ${dialect.ifElse(
        "bps.users <= 1",
        "0",
        `POWER(bpw.weight, 2) * ((
          (bps.${alias}denominator_sum_squares - POWER(bps.${alias}denominator_sum, 2) / bps.users) / (bps.users - 1))
        ) / bps.users
      `,
      )}) * (SUM(bps.users) - 1) + POWER(
        SUM(bpw.weight * bps.${alias}denominator_sum / bps.users), 2)
      ) AS ${alias}denominator_sum_squares
      , SUM(bps.users) * (
          (SUM(bps.users) - 1) * SUM(
            ${dialect.ifElse(
              "bps.users <= 1",
              "0",
              `
            POWER(bpw.weight, 2) / (bps.users * (bps.users - 1)) * (
              bps.${alias}main_denominator_sum_product - bps.${alias}main_sum * bps.${alias}denominator_sum / bps.users
            )
          `,
            )}) +
          (
            SUM(bpw.weight * bps.${alias}main_sum / bps.users) * SUM(bpw.weight * bps.${alias}denominator_sum / bps.users)
          )
        ) AS ${alias}main_denominator_sum_product`
        : ""
    }
    ${
      data.regressionAdjusted
        ? `
      , SUM(bpw.weight * bps.${alias}covariate_sum / bps.users) * SUM(bps.users) AS ${alias}covariate_sum
      , SUM(bps.users) * (SUM(
      ${dialect.ifElse(
        "bps.users <= 1",
        "0",
        `POWER(bpw.weight, 2) * ((
          (bps.${alias}covariate_sum_squares - POWER(bps.${alias}covariate_sum, 2) / bps.users) / (bps.users - 1))
        ) / bps.users
      `,
      )}) * (SUM(bps.users) - 1) + POWER(SUM(bpw.weight * bps.${alias}covariate_sum / bps.users), 2)) AS ${alias}covariate_sum_squares
      , SUM(bps.users) * (
          (SUM(bps.users) - 1) * SUM(
            ${dialect.ifElse(
              "bps.users <= 1",
              "0",
              `
            POWER(bpw.weight, 2) / (bps.users * (bps.users - 1)) * (
              bps.${alias}main_covariate_sum_product - bps.${alias}main_sum * bps.${alias}covariate_sum / bps.users
            )
          `,
            )}) +
          (
            SUM(bpw.weight * bps.${alias}main_sum / bps.users) * SUM(bpw.weight * bps.${alias}covariate_sum / bps.users)
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
      ${dimensionCols
        .map((d) => `AND bps.${d.alias} = bpw.${d.alias}`)
        .join("\n")}
    )
  ${
    hasRegressionAdjustment
      ? `
    LEFT JOIN
      __theta t
      ON (${dimensionCols
        .map((d) => `bps.${d.alias} = t.${d.alias}`)
        .join(" AND ")})
    `
      : ""
  }
  GROUP BY
    bps.variation
    ${dimensionCols.map((d) => `, bps.${d.alias}`).join("")}
  `;
}
