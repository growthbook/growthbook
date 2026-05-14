import cloneDeep from "lodash/cloneDeep";
import {
  eligibleForUncappedMetric,
  getUserIdTypes,
  isFunnelMetric,
  isPercentileCappedMetric,
  isRatioMetric,
  isRegressionAdjusted,
} from "shared/experiments";
import { format } from "shared/sql";
import type { DataSourceInterface } from "shared/types/datasource";
import type { ExperimentMetricQueryParams } from "shared/types/integrations";
import type { MetricInterface } from "shared/types/metric";
import type { SqlDialect } from "shared/types/sql";
import { applyMetricOverrides } from "back-end/src/util/integration";

import { addCaseWhenTimeFilter } from "back-end/src/integrations/sql/clauses/add-case-when-time-filter";
import { addHours } from "back-end/src/integrations/sql/primitives/add-hours";
import { getAggregateMetricColumnLegacyMetrics } from "back-end/src/integrations/sql/columns/aggregate-metric-column-legacy-metrics";
import { getBanditCaseWhen } from "back-end/src/integrations/sql/clauses/bandit-case-when";
import { getBanditStatisticsCTE } from "back-end/src/integrations/sql/ctes/bandit-statistics-cte";
import { capCoalesceValue } from "back-end/src/integrations/sql/primitives/cap-coalesce-value";
import { getConversionWindowClause } from "back-end/src/integrations/sql/clauses/conversion-window-clause";
import { getDimensionCol } from "back-end/src/integrations/sql/columns/dimension-col";
import { getExperimentEndDate } from "back-end/src/integrations/sql/dates/experiment-end-date";
import { getExperimentUnitsQuery } from "back-end/src/integrations/sql/queries/experiment-units-query";
import { getExposureQuery } from "back-end/src/integrations/sql/queries/exposure-query";
import { getFunnelUsersCTE } from "back-end/src/integrations/sql/ctes/funnel-users-cte";
import { getIdentitiesCTE } from "back-end/src/integrations/sql/ctes/identities-cte";
import { getMaxHoursToConvert } from "back-end/src/integrations/sql/dates/max-hours-to-convert";
import { getMetricCTE } from "back-end/src/integrations/sql/ctes/metric-cte";
import { getMetricEnd } from "back-end/src/integrations/sql/dates/metric-end";
import { getMetricMinDelay } from "back-end/src/integrations/sql/dates/metric-min-delay";
import { getMetricStart } from "back-end/src/integrations/sql/dates/metric-start";
import { processActivationMetric } from "back-end/src/integrations/sql/processing/process-activation-metric";
import { processDimensions } from "back-end/src/integrations/sql/processing/process-dimensions";

export function getExperimentMetricQuery(
  dialect: SqlDialect,
  datasource: DataSourceInterface,
  params: ExperimentMetricQueryParams,
): string {
  const {
    metric: metricDoc,
    denominatorMetrics: denominatorMetricsDocs,
    activationMetric: activationMetricDoc,
    settings,
    segment,
  } = params;

  const factTableMap = params.factTableMap;

  // clone the metrics before we mutate them
  const metric = cloneDeep<MetricInterface>(metricDoc);
  const denominatorMetrics = cloneDeep<MetricInterface[]>(
    denominatorMetricsDocs,
  );
  const activationMetric = processActivationMetric(
    activationMetricDoc,
    settings,
  );

  applyMetricOverrides(metric, settings);
  denominatorMetrics.forEach((m) => applyMetricOverrides(m, settings));

  // Replace any placeholders in the user defined dimension SQL
  const { unitDimensions } = processDimensions(
    dialect,
    params.dimensions,
    settings,
    activationMetric,
  );

  const userIdType =
    params.forcedUserIdType ??
    getExposureQuery(datasource, settings.exposureQueryId || "").userIdType;

  const denominator =
    denominatorMetrics.length > 0
      ? denominatorMetrics[denominatorMetrics.length - 1]
      : undefined;
  // If the denominator is a binomial, it's just acting as a filter
  // e.g. "Purchase/Signup" is filtering to users who signed up and then counting purchases
  // When the denominator is a count, it's a real ratio, dividing two quantities
  // e.g. "Pages/Session" is dividing number of page views by number of sessions
  const ratioMetric = isRatioMetric(metric, denominator);
  const funnelMetric = isFunnelMetric(metric, denominator);

  const banditDates = settings.banditSettings?.historicalWeights.map(
    (w) => w.date,
  );

  // redundant checks to make sure configuration makes sense and we only build expensive queries for the cases
  // where RA is actually possible
  const regressionAdjusted =
    settings.regressionAdjustmentEnabled &&
    isRegressionAdjusted(metric, denominator) &&
    // and block RA for experiment metric query only, only works for optimized queries
    !isRatioMetric(metric, denominator);

  const regressionAdjustmentHours = regressionAdjusted
    ? (metric.regressionAdjustmentDays ?? 0) * 24
    : 0;

  const overrideConversionWindows =
    settings.attributionModel === "experimentDuration" ||
    settings.attributionModel === "lookbackOverride";

  // Get capping settings and final coalesce statement
  const isPercentileCapped = isPercentileCappedMetric(metric);
  const computeUncappedMetric = eligibleForUncappedMetric(metric);

  const denominatorIsPercentileCapped = denominator
    ? isPercentileCappedMetric(denominator)
    : false;

  const denominatorComputeUncappedMetric = denominator
    ? eligibleForUncappedMetric(denominator)
    : false;

  const capCoalesceMetric = capCoalesceValue(dialect, {
    valueCol: "m.value",
    metric,
    capTablePrefix: "cap",
    columnRef: null,
  });
  const capCoalesceDenominator = denominator
    ? capCoalesceValue(dialect, {
        valueCol: "d.value",
        metric: denominator,
        capTablePrefix: "capd",
        columnRef: null,
      })
    : "";
  const capCoalesceCovariate = capCoalesceValue(dialect, {
    valueCol: "c.value",
    metric: metric,
    capTablePrefix: "cap",
    columnRef: null,
  });
  const uncappedMetric = {
    ...metric,
    cappingSettings: {
      type: "" as const,
      value: 0,
    },
  };
  const uncappedDenominator = denominator
    ? {
        ...denominator,
        cappingSettings: {
          type: "" as const,
          value: 0,
        },
      }
    : undefined;
  const uncappedCovariate = {
    ...metric,
    cappingSettings: {
      type: "" as const,
      value: 0,
    },
  };
  const uncappedCoalesceMetric = capCoalesceValue(dialect, {
    valueCol: "m.value",
    metric: uncappedMetric,
    capTablePrefix: "cap",
    columnRef: null,
  });
  const uncappedCoalesceDenominator = uncappedDenominator
    ? capCoalesceValue(dialect, {
        valueCol: "d.value",
        metric: uncappedDenominator,
        capTablePrefix: "capd",
        columnRef: null,
      })
    : "";
  const uncappedCoalesceCovariate = capCoalesceValue(dialect, {
    valueCol: "c.value",
    metric: uncappedCovariate,
    capTablePrefix: "cap",
    columnRef: null,
  });
  // Get rough date filter for metrics to improve performance
  const orderedMetrics = (activationMetric ? [activationMetric] : [])
    .concat(denominatorMetrics)
    .concat([metric]);
  const minMetricDelay = getMetricMinDelay(orderedMetrics);
  const metricStart = getMetricStart(
    settings.startDate,
    minMetricDelay,
    regressionAdjustmentHours,
  );
  const metricEnd = getMetricEnd(
    orderedMetrics,
    settings.endDate,
    overrideConversionWindows,
  );

  // Get any required identity join queries
  const idTypeObjects = [
    [userIdType],
    getUserIdTypes(metric, factTableMap),
    ...denominatorMetrics.map((m) => getUserIdTypes(m, factTableMap, true)),
  ];
  // add idTypes usually handled in units query here in the case where
  // we don't have a separate table for the units query
  if (params.unitsSource === "exposureQuery") {
    idTypeObjects.push(
      ...unitDimensions.map((d) => [d.dimension.userIdType || "user_id"]),
      segment ? [segment.userIdType || "user_id"] : [],
      activationMetric ? getUserIdTypes(activationMetric, factTableMap) : [],
    );
  }
  const { baseIdType, idJoinMap, idJoinSQL } = getIdentitiesCTE(
    dialect,
    datasource.settings,
    {
      objects: idTypeObjects,
      from: settings.startDate,
      to: settings.endDate,
      forcedBaseIdType: userIdType,
      experimentId: settings.experimentId,
    },
  );

  // Get date range for experiment and analysis
  const endDate: Date = getExperimentEndDate(
    settings,
    getMaxHoursToConvert(
      funnelMetric,
      [metric].concat(denominatorMetrics),
      activationMetric,
    ),
  );

  const dimensionCols = params.dimensions.map((d) =>
    getDimensionCol(dialect, d),
  );
  // if bandit and there is no dimension column, we need to create a dummy column to make some of the joins
  // work later on. `"dimension"` is a special column that gbstats can handle if there is no dimension
  // column specified. See `BANDIT_DIMENSION` in gbstats.py.
  if (banditDates?.length && dimensionCols.length === 0) {
    dimensionCols.push({
      alias: "dimension",
      value: dialect.castToString("'All'"),
    });
  }

  const computeOnActivatedUsersOnly =
    activationMetric !== null &&
    !params.dimensions.some((d) => d.type === "activation");
  const timestampColumn = computeOnActivatedUsersOnly
    ? "first_activation_timestamp"
    : "first_exposure_timestamp";

  const distinctUsersWhere: string[] = [];

  if (computeOnActivatedUsersOnly) {
    distinctUsersWhere.push("first_activation_timestamp IS NOT NULL");
  }
  if (settings.skipPartialData) {
    distinctUsersWhere.push(
      `${timestampColumn} <= ${dialect.toTimestamp(endDate)}`,
    );
  }

  return format(
    `-- ${metric.name} (${metric.type})
WITH
  ${idJoinSQL}
  ${
    params.unitsSource === "exposureQuery"
      ? `${getExperimentUnitsQuery(dialect, datasource, {
          ...params,
          includeIdJoins: false,
        })},`
      : params.unitsSource === "otherQuery"
        ? params.unitsSql
        : ""
  }
  __distinctUsers AS (
    SELECT
      ${baseIdType}
      ${dimensionCols.map((c) => `, ${c.value} AS ${c.alias}`).join("")}
      , variation
      , ${timestampColumn} AS timestamp
      , ${dialect.dateTrunc("first_exposure_timestamp", "day")} AS first_exposure_date
      ${banditDates?.length ? getBanditCaseWhen(dialect, banditDates) : ""}
      ${
        regressionAdjusted
          ? `, ${addHours(
              dialect,
              "first_exposure_timestamp",
              minMetricDelay,
            )} AS preexposure_end
            , ${addHours(
              dialect,
              "first_exposure_timestamp",
              minMetricDelay - regressionAdjustmentHours,
            )} AS preexposure_start`
          : ""
      }
    FROM ${
      params.unitsSource === "exposureTable"
        ? `${params.unitsTableFullName}`
        : "__experimentUnits"
    }
    ${
      distinctUsersWhere.length
        ? `WHERE ${distinctUsersWhere.join(" AND ")}`
        : ""
    }
  )
  , __metric as (${getMetricCTE(dialect, {
    metric,
    baseIdType,
    idJoinMap,
    startDate: metricStart,
    endDate: metricEnd,
    experimentId: settings.experimentId,
    phase: settings.phase,
    customFields: settings.customFields,
    factTableMap,
  })})
  ${denominatorMetrics
    .map((m, i) => {
      return `, __denominator${i} as (${getMetricCTE(dialect, {
        metric: m,
        baseIdType,
        idJoinMap,
        startDate: metricStart,
        endDate: metricEnd,
        experimentId: settings.experimentId,
        phase: settings.phase,
        customFields: settings.customFields,
        factTableMap,
        useDenominator: true,
      })})`;
    })
    .join("\n")}
  ${
    funnelMetric
      ? `, __denominatorUsers as (${getFunnelUsersCTE(
          dialect,
          baseIdType,
          denominatorMetrics,
          settings.endDate,
          dimensionCols,
          regressionAdjusted,
          overrideConversionWindows,
          banditDates,
          "__denominator",
          "__distinctUsers",
        )})`
      : ""
  }
  , __userMetricJoin as (
    SELECT
      d.variation AS variation
      ${dimensionCols.map((c) => `, d.${c.alias} AS ${c.alias}`).join("")}
      ${banditDates?.length ? `, d.bandit_period AS bandit_period` : ""}
      , d.${baseIdType} AS ${baseIdType}
      , ${addCaseWhenTimeFilter(dialect, {
        col: "m.value",
        metric,
        overrideConversionWindows,
        endDate: settings.endDate,
        metricTimestampColExpr: "m.timestamp",
        exposureTimestampColExpr: "d.timestamp",
      })} as value
    FROM
      ${funnelMetric ? "__denominatorUsers" : "__distinctUsers"} d
    LEFT JOIN __metric m ON (
      m.${baseIdType} = d.${baseIdType}
    )
  )
  , __userMetricAgg as (
    -- Add in the aggregate metric value for each user
    SELECT
      umj.variation AS variation
      ${dimensionCols.map((c) => `, umj.${c.alias} AS ${c.alias}`).join("")}
      ${banditDates?.length ? `, umj.bandit_period AS bandit_period` : ""}
      , umj.${baseIdType}
      , ${getAggregateMetricColumnLegacyMetrics(dialect, {
        metric,
      })} as value
    FROM
      __userMetricJoin umj
    GROUP BY
      umj.variation
      ${dimensionCols.map((c) => `, umj.${c.alias}`).join("")}
      ${banditDates?.length ? `, umj.bandit_period` : ""}
      , umj.${baseIdType}
  )
  ${
    isPercentileCapped
      ? `
    , __capValue AS (
        ${dialect.percentileCapSelectClause(
          [
            {
              valueCol: "value",
              outputCol: "value_cap",
              percentile: metric.cappingSettings.value ?? 1,
              ignoreZeros: metric.cappingSettings.ignoreZeros ?? false,
              sourceIndex: 0,
            },
          ],
          "__userMetricAgg",
          `WHERE value IS NOT NULL${
            metric.cappingSettings.ignoreZeros ? " AND value != 0" : ""
          }`,
        )}
    )
    `
      : ""
  }
  ${
    denominator && ratioMetric
      ? `, __userDenominatorAgg AS (
          SELECT
            d.variation AS variation
            ${dimensionCols.map((c) => `, d.${c.alias} AS ${c.alias}`).join("")}
            ${banditDates?.length ? `, d.bandit_period AS bandit_period` : ""}
            , d.${baseIdType} AS ${baseIdType}
            , ${getAggregateMetricColumnLegacyMetrics(dialect, {
              metric: denominator,
            })} as value
          FROM
            __distinctUsers d
            JOIN __denominator${denominatorMetrics.length - 1} m ON (
              m.${baseIdType} = d.${baseIdType}
            )
          WHERE
            ${getConversionWindowClause(
              dialect,
              "d.timestamp",
              "m.timestamp",
              denominator,
              settings.endDate,
              overrideConversionWindows,
            )}
          GROUP BY
            d.variation
            ${dimensionCols.map((c) => `, d.${c.alias}`).join("")}
            ${banditDates?.length ? `, d.bandit_period` : ""}
            , d.${baseIdType}
        )
        ${
          denominator && denominatorIsPercentileCapped
            ? `
          , __capValueDenominator AS (
            ${dialect.percentileCapSelectClause(
              [
                {
                  valueCol: "value",
                  outputCol: "value_cap",
                  percentile: denominator.cappingSettings.value ?? 1,
                  ignoreZeros: denominator.cappingSettings.ignoreZeros ?? false,
                  sourceIndex: 0,
                },
              ],
              "__userDenominatorAgg",
              `WHERE value IS NOT NULL${
                denominator.cappingSettings.ignoreZeros ? " AND value != 0" : ""
              }`,
            )}
          )
          `
            : ""
        }`
      : ""
  }
  ${
    regressionAdjusted
      ? `
    , __userCovariateMetric as (
      SELECT
        d.variation AS variation
        ${dimensionCols.map((c) => `, d.${c.alias} AS ${c.alias}`).join("")}
        , d.${baseIdType} AS ${baseIdType}
        , ${getAggregateMetricColumnLegacyMetrics(dialect, {
          metric,
        })} as value
      FROM
        __distinctUsers d
        JOIN __metric m ON (
          m.${baseIdType} = d.${baseIdType}
        )
      WHERE 
        m.timestamp >= d.preexposure_start
        AND m.timestamp < d.preexposure_end
      GROUP BY
        d.variation
        ${dimensionCols.map((c) => `, d.${c.alias}`).join("")}
        , d.${baseIdType}
    )
    `
      : ""
  }
  ${
    banditDates?.length
      ? getBanditStatisticsCTE(dialect, {
          baseIdType,
          metricData: [
            {
              alias: "",
              id: metric.id,
              ratioMetric,
              regressionAdjusted,
              isPercentileCapped,
              capCoalesceMetric,
              capCoalesceCovariate,
              capCoalesceDenominator,
              numeratorSourceIndex: 0,
              denominatorSourceIndex: 0,
            },
          ],
          dimensionCols,
          hasRegressionAdjustment: regressionAdjusted,
          hasCapping: isPercentileCapped || denominatorIsPercentileCapped,
          ignoreNulls: "ignoreNulls" in metric && metric.ignoreNulls,
          denominatorIsPercentileCapped,
        })
      : `
  -- One row per variation/dimension with aggregations
  SELECT
m.variation AS variation
${dimensionCols.map((c) => `, m.${c.alias} AS ${c.alias}`).join("")}
, COUNT(*) AS users
${
  computeUncappedMetric
    ? `, SUM(${uncappedCoalesceMetric}) AS main_sum_uncapped
       , SUM(POWER(${uncappedCoalesceMetric}, 2)) AS main_sum_squares_uncapped
       ${
         isPercentileCapped
           ? `
       , MAX(COALESCE(cap.value_cap, 0)) as main_cap_value`
           : ""
       }`
    : ""
}
, SUM(${capCoalesceMetric}) AS main_sum
, SUM(POWER(${capCoalesceMetric}, 2)) AS main_sum_squares
${
  ratioMetric
    ? `
  ${
    denominatorComputeUncappedMetric
      ? `, SUM(${uncappedCoalesceDenominator}) AS denominator_sum_uncapped
         , SUM(POWER(${uncappedCoalesceDenominator}, 2)) AS denominator_sum_squares_uncapped
         , SUM(${uncappedCoalesceMetric} * ${uncappedCoalesceDenominator}) AS main_denominator_sum_product_uncapped
         ${
           denominatorIsPercentileCapped
             ? `
         , MAX(COALESCE(capd.value_cap, 0)) as denominator_cap_value`
             : ""
         }`
      : ""
  }
  , SUM(${capCoalesceDenominator}) AS denominator_sum
  , SUM(POWER(${capCoalesceDenominator}, 2)) AS denominator_sum_squares
  , SUM(${capCoalesceDenominator} * ${capCoalesceMetric}) AS main_denominator_sum_product
`
    : ""
}
${
  regressionAdjusted
    ? `
    ${
      computeUncappedMetric
        ? `, SUM(${uncappedCoalesceCovariate}) AS covariate_sum_uncapped
           , SUM(POWER(${uncappedCoalesceCovariate}, 2)) AS covariate_sum_squares_uncapped
           , SUM(${uncappedCoalesceMetric} * ${uncappedCoalesceCovariate}) AS main_covariate_sum_product_uncapped`
        : ""
    }
  , SUM(${capCoalesceCovariate}) AS covariate_sum
  , SUM(POWER(${capCoalesceCovariate}, 2)) AS covariate_sum_squares
  , SUM(${capCoalesceMetric} * ${capCoalesceCovariate}) AS main_covariate_sum_product
  `
    : ""
}
  FROM
__userMetricAgg m
  ${
    ratioMetric
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
    regressionAdjusted
      ? `
  LEFT JOIN __userCovariateMetric c
  ON (c.${baseIdType} = m.${baseIdType})
  `
      : ""
  }
  ${isPercentileCapped ? `CROSS JOIN __capValue cap` : ""}
  ${"ignoreNulls" in metric && metric.ignoreNulls ? `WHERE m.value != 0` : ""}
  GROUP BY
m.variation
${dimensionCols.map((c) => `, m.${c.alias}`).join("")}
  `
  }`,
    dialect.formatDialect,
  );
}
