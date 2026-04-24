import cloneDeep from "lodash/cloneDeep";
import { getUserIdTypes } from "shared/experiments";
import { format } from "shared/sql";
import type { DataSourceInterface } from "shared/types/datasource";
import type {
  DimensionColumnData,
  ExperimentFactMetricsQueryParams,
  FactMetricPercentileData,
} from "shared/types/integrations";
import type { SqlHelpers } from "shared/types/sql";
import { applyMetricOverrides } from "back-end/src/util/integration";

import { addCaseWhenTimeFilter } from "./add-case-when-time-filter";
import { addHours } from "./add-hours";
import { getBanditCaseWhen } from "./bandit-case-when";
import { getBanditStatisticsFactMetricCTE } from "./bandit-statistics-fact-metric-cte";
import { getDimensionCol } from "./dimension-col";
import { getExperimentEndDate } from "./experiment-end-date";
import { getExperimentFactMetricStatisticsCTE } from "./experiment-fact-metric-statistics-cte";
import { getExperimentUnitsQuery } from "./experiment-units-query";
import { getExposureQuery } from "./exposure-query";
import { getFactMetricCTE } from "./fact-metric-cte";
import { getFactMetricQuantileData } from "./fact-metric-quantile-data";
import { getFactTablesForMetrics } from "./fact-tables-for-metrics";
import { getIdentitiesCTE } from "./identities-cte";
import { getMetricData } from "./metric-data";
import { processActivationMetric } from "./process-activation-metric";
import { processDimensions } from "./process-dimensions";
import { getQuantileGridColumns } from "./quantile-grid-columns";

export function getExperimentFactMetricsQuery(
  helpers: SqlHelpers,
  datasource: DataSourceInterface,
  params: ExperimentFactMetricsQueryParams,
): string {
  const { settings, segment } = params;
  const metricsWithIndices = cloneDeep(params.metrics).map((m, i) => ({
    metric: m,
    index: i,
  }));
  const activationMetric = processActivationMetric(
    params.activationMetric,
    settings,
  );

  metricsWithIndices.forEach((m) => {
    applyMetricOverrides(m.metric, settings);
  });
  // Replace any placeholders in the user defined dimension SQL
  const { unitDimensions } = processDimensions(
    params.dimensions,
    settings,
    activationMetric,
  );

  const factTableMap = params.factTableMap;

  const factTablesWithIndices = getFactTablesForMetrics(
    metricsWithIndices,
    factTableMap,
  );

  const factTable = factTablesWithIndices[0]?.factTable;

  const queryName = `${
    factTablesWithIndices.length === 1
      ? `Fact Table`
      : `Cross-Fact Table Metrics`
  }: ${factTablesWithIndices.map((f) => f.factTable.name).join(" & ")}`;

  const userIdType =
    params.forcedUserIdType ??
    getExposureQuery(datasource, settings.exposureQueryId || "").userIdType;

  const metricData = metricsWithIndices.map((metric) =>
    getMetricData(
      helpers,
      metric,
      settings,
      activationMetric,
      factTablesWithIndices,
      "m",
      `m${metric.index}`,
    ),
  );

  // TODO(sql): Separate metric start by fact table
  const raMetricSettings = metricData
    .filter((m) => m.regressionAdjusted)
    .map((m) => m.raMetricFirstExposureSettings);
  const maxHoursToConvert = Math.max(
    ...metricData.map((m) => m.maxHoursToConvert),
  );
  const metricStart = metricData.reduce(
    (min, d) => (d.metricStart < min ? d.metricStart : min),
    settings.startDate,
  );
  const metricEnd = metricData.reduce(
    (max, d) => (d.metricEnd && d.metricEnd > max ? d.metricEnd : max),
    settings.endDate,
  );

  // Get any required identity join queries
  const idTypeObjects = [[userIdType], factTable.userIdTypes || []];
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
    helpers,
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
  const endDate: Date = getExperimentEndDate(settings, maxHoursToConvert);

  const banditDates = settings.banditSettings?.historicalWeights.map(
    (w) => w.date,
  );

  const dimensionCols: DimensionColumnData[] = params.dimensions.map((d) =>
    getDimensionCol(helpers, d),
  );
  // if bandit and there is no dimension column, we need to create a dummy column to make some of the joins
  // work later on. `"dimension"` is a special column that gbstats can handle if there is no dimension
  // column specified. See `BANDIT_DIMENSION` in gbstats.py.
  if (banditDates?.length && dimensionCols.length === 0) {
    dimensionCols.push({
      alias: "dimension",
      value: helpers.castToString("'All'"),
    });
  }

  const computeOnActivatedUsersOnly =
    activationMetric !== null &&
    !params.dimensions.some((d) => d.type === "activation");
  const timestampColumn = computeOnActivatedUsersOnly
    ? "first_activation_timestamp"
    : "first_exposure_timestamp";

  const distinctUsersWhere: string[] = [];

  // If activation metric, drop non-activated users unless doing
  // splits by activation metric
  if (computeOnActivatedUsersOnly) {
    distinctUsersWhere.push("first_activation_timestamp IS NOT NULL");
  }
  if (settings.skipPartialData) {
    distinctUsersWhere.push(
      `${timestampColumn} <= ${helpers.toTimestamp(endDate)}`,
    );
  }

  // TODO(sql): refactor so this is a property of the source table itself
  const percentileTableIndices = new Set<number>();
  const percentileData: FactMetricPercentileData[] = [];
  metricData
    .filter((m) => m.isPercentileCapped)
    .forEach((m) => {
      percentileData.push({
        valueCol: `${m.alias}_value`,
        outputCol: `${m.alias}_value_cap`,
        percentile: m.metric.cappingSettings.value ?? 1,
        ignoreZeros: m.metric.cappingSettings.ignoreZeros ?? false,
        sourceIndex: m.numeratorSourceIndex,
      });
      percentileTableIndices.add(m.numeratorSourceIndex);
      if (m.ratioMetric) {
        percentileData.push({
          valueCol: `${m.alias}_denominator`,
          outputCol: `${m.alias}_denominator_cap`,
          percentile: m.metric.cappingSettings.value ?? 1,
          ignoreZeros: m.metric.cappingSettings.ignoreZeros ?? false,
          sourceIndex: m.denominatorSourceIndex,
        });
        percentileTableIndices.add(m.denominatorSourceIndex);
      }
    });

  const eventQuantileData = getFactMetricQuantileData(metricData, "event");
  // TODO(sql): error if event quantiles have two tables

  if (
    params.dimensions.length > 1 &&
    metricData.some((m) => !!m.quantileMetric)
  ) {
    throw new Error(
      "ImplementationError: quantile metrics are not supported with pre-computed dimension breakdowns",
    );
  }

  const regressionAdjustedMetrics = metricData.filter(
    (m) => m.regressionAdjusted,
  );
  // TODO(sql): refactor so this is a property of the source table itself
  const regressionAdjustedTableIndices = new Set<number>();
  regressionAdjustedMetrics.forEach((m) => {
    regressionAdjustedTableIndices.add(m.numeratorSourceIndex);
    if (m.ratioMetric && m.denominatorSourceIndex !== m.numeratorSourceIndex) {
      regressionAdjustedTableIndices.add(m.denominatorSourceIndex);
    }
  });

  return format(
    `-- ${queryName}
  WITH
    ${idJoinSQL}
    ${
      params.unitsSource === "exposureQuery"
        ? `${getExperimentUnitsQuery(helpers, datasource, {
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
        , ${helpers.dateTrunc("first_exposure_timestamp", "day")} AS first_exposure_date
        ${banditDates?.length ? getBanditCaseWhen(helpers, banditDates) : ""}
    ${raMetricSettings
      .map(
        ({ alias, hours, minDelay }) => `
            , ${addHours(
              helpers,
              "first_exposure_timestamp",
              minDelay,
            )} AS ${alias}_preexposure_end
            , ${addHours(
              helpers,
              "first_exposure_timestamp",
              minDelay - hours,
            )} AS ${alias}_preexposure_start`,
      )
      .join("\n")}
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
    ${factTablesWithIndices
      .map(
        (f) =>
          `, __factTable${f.index === 0 ? "" : f.index} as (
        ${getFactMetricCTE(helpers, {
          baseIdType,
          idJoinMap,
          factTable: f.factTable,
          metricsWithIndices,
          endDate: metricEnd,
          startDate: metricStart,
          experimentId: settings.experimentId,
          addFiltersToWhere: true,
          phase: settings.phase,
          customFields: settings.customFields,
        })}
      )
      , __userMetricJoin${f.index === 0 ? "" : f.index} as (
        SELECT
          d.variation AS variation
          , d.timestamp AS timestamp
          ${dimensionCols.map((c) => `, d.${c.alias} AS ${c.alias}`).join("")}
          ${banditDates?.length ? `, d.bandit_period AS bandit_period` : ""}
          , d.${baseIdType} AS ${baseIdType}
          ${metricData
            .map(
              (data) =>
                `${
                  data.numeratorSourceIndex === f.index
                    ? `, ${addCaseWhenTimeFilter(helpers, {
                        col: `m.${data.alias}_value`,
                        metric: data.metric,
                        overrideConversionWindows:
                          data.overrideConversionWindows,
                        endDate: settings.endDate,
                        metricQuantileSettings: data.quantileMetric
                          ? data.metricQuantileSettings
                          : undefined,
                        metricTimestampColExpr: "m.timestamp",
                        exposureTimestampColExpr: "d.timestamp",
                      })} as ${data.alias}_value`
                    : ""
                }
                ${
                  data.ratioMetric && data.denominatorSourceIndex === f.index
                    ? `, ${addCaseWhenTimeFilter(helpers, {
                        col: `m.${data.alias}_denominator`,
                        metric: data.metric,
                        overrideConversionWindows:
                          data.overrideConversionWindows,
                        endDate: settings.endDate,
                        metricTimestampColExpr: "m.timestamp",
                        exposureTimestampColExpr: "d.timestamp",
                      })} as ${data.alias}_denominator`
                    : ""
                }
                `,
            )
            .join("\n")}
          ${
            // CUPED pre-exposure covariate columns: emitted here so that
            // __userCovariateMetric can aggregate them from __userMetricJoin
            // instead of re-scanning __factTable. See getCovariateMetricCTE.
            regressionAdjustedTableIndices.has(f.index)
              ? regressionAdjustedMetrics
                  .map(
                    (metric) =>
                      `${
                        metric.numeratorSourceIndex === f.index
                          ? `, ${helpers.ifElse(
                              `m.timestamp >= d.${metric.alias}_preexposure_start AND m.timestamp < d.${metric.alias}_preexposure_end`,
                              `m.${metric.alias}_value`,
                              "NULL",
                            )} AS ${metric.alias}_covariate_value`
                          : ""
                      }${
                        metric.ratioMetric &&
                        metric.denominatorSourceIndex === f.index
                          ? `, ${helpers.ifElse(
                              `m.timestamp >= d.${metric.alias}_preexposure_start AND m.timestamp < d.${metric.alias}_preexposure_end`,
                              `m.${metric.alias}_denominator`,
                              "NULL",
                            )} AS ${metric.alias}_covariate_denominator`
                          : ""
                      }`,
                  )
                  .join("\n")
              : ""
          }
        FROM
          __distinctUsers d
        LEFT JOIN __factTable${f.index === 0 ? "" : f.index} m ON (
          m.${baseIdType} = d.${baseIdType}
        )
      )
    ${
      eventQuantileData.length
        ? `
      , __eventQuantileMetric${f.index === 0 ? "" : f.index} AS (
        SELECT
        m.variation AS variation
        ${dimensionCols.map((c) => `, m.${c.alias} AS ${c.alias}`).join("")}
        ${eventQuantileData
          .map((data) =>
            getQuantileGridColumns(
              helpers,
              data.metricQuantileSettings,
              `${data.alias}_`,
            ),
          )
          .join("\n")}
      FROM
        __userMetricJoin${f.index === 0 ? "" : f.index} m
      GROUP BY
        m.variation
        ${dimensionCols.map((c) => `, m.${c.alias}`).join("")}
      )`
        : ""
    }
    , __userMetricAgg${f.index === 0 ? "" : f.index} as (
      -- Add in the aggregate metric value for each user
      SELECT
        umj.variation
        ${dimensionCols.map((c) => `, umj.${c.alias} AS ${c.alias}`).join("")}
        ${banditDates?.length ? `, umj.bandit_period` : ""}
        , umj.${baseIdType}
        ${metricData
          .map((data) => {
            return `${
              data.numeratorSourceIndex === f.index
                ? `, ${data.aggregatedValueTransformation({
                    column: data.numeratorAggFns.fullAggregationFunction(
                      `umj.${data.alias}_value`,
                      `qm.${data.alias}_quantile`,
                    ),
                    initialTimestampColumn: "MIN(umj.timestamp)",
                    analysisEndDate: params.settings.endDate,
                  })} AS ${data.alias}_value`
                : ""
            }
              ${
                data.ratioMetric && data.denominatorSourceIndex === f.index
                  ? `, ${data.aggregatedValueTransformation({
                      column: data.denominatorAggFns.fullAggregationFunction(
                        `umj.${data.alias}_denominator`,
                        `qm.${data.alias}_quantile`,
                      ),
                      initialTimestampColumn: "MIN(umj.timestamp)",
                      analysisEndDate: params.settings.endDate,
                    })} AS ${data.alias}_denominator`
                  : ""
              }`;
          })
          .join("\n")}
        ${eventQuantileData
          .map(
            (data) =>
              `, COUNT(umj.${data.alias}_value) AS ${data.alias}_n_events`,
          )
          .join("\n")}
        ${
          regressionAdjustedTableIndices.has(f.index)
            ? regressionAdjustedMetrics
                .map(
                  (metric) =>
                    `${
                      metric.numeratorSourceIndex === f.index
                        ? `, ${metric.covariateNumeratorAggFns.fullAggregationFunction(
                            `umj.${metric.alias}_covariate_value`,
                          )} AS ${metric.alias}_covariate_value`
                        : ""
                    }${
                      metric.ratioMetric &&
                      metric.denominatorSourceIndex === f.index
                        ? `, ${metric.covariateDenominatorAggFns.fullAggregationFunction(
                            `umj.${metric.alias}_covariate_denominator`,
                          )} AS ${metric.alias}_covariate_denominator`
                        : ""
                    }`,
                )
                .join("\n")
            : ""
        }
      FROM
        __userMetricJoin${f.index === 0 ? "" : f.index} umj
      ${
        eventQuantileData.length
          ? `
      LEFT JOIN __eventQuantileMetric${f.index === 0 ? "" : f.index} qm
      ON (qm.variation = umj.variation ${dimensionCols
        .map((c) => `AND qm.${c.alias} = umj.${c.alias}`)
        .join("\n")})`
          : ""
      }
      GROUP BY
        umj.variation
        ${dimensionCols.map((c) => `, umj.${c.alias}`).join("")}
        ${banditDates?.length ? `, umj.bandit_period` : ""}
        , umj.${baseIdType}
    )
    ${
      percentileTableIndices.has(f.index)
        ? `
      , __capValue${f.index === 0 ? "" : f.index} AS (
          ${helpers.percentileCapSelectClause(
            percentileData.filter((p) => p.sourceIndex === f.index),
            `__userMetricAgg${f.index === 0 ? "" : f.index}`,
          )}
      )
      `
        : ""
    }
    `,
      )
      .join("\n")}    
    ${
      banditDates?.length
        ? getBanditStatisticsFactMetricCTE(helpers, {
            baseIdType,
            metricData,
            dimensionCols,
            factTablesWithIndices,
            regressionAdjustedTableIndices,
            percentileTableIndices,
          })
        : `
    -- One row per variation/dimension with aggregations
    ${getExperimentFactMetricStatisticsCTE(helpers, {
      dimensionCols,
      metricData,
      eventQuantileData,
      baseIdType,
      joinedMetricTableName: "__userMetricAgg",
      eventQuantileTableName: "__eventQuantileMetric",
      capValueTableName: "__capValue",
      factTablesWithIndices,
      percentileTableIndices,
    })}
    `
    }`,
    helpers.formatDialect,
  );
}
