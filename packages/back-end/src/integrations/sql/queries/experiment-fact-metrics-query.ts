import cloneDeep from "lodash/cloneDeep";
import {
  getUserIdTypes,
  isLowerPercentileCappedMetric,
  isUpperPercentileCappedMetric,
} from "shared/experiments";
import { format } from "shared/sql";
import type { DataSourceInterface } from "shared/types/datasource";
import type {
  DimensionColumnData,
  ExperimentFactMetricsQueryParams,
  FactMetricPercentileData,
} from "shared/types/integrations";
import type { SqlDialect } from "shared/types/sql";
import { applyMetricOverrides } from "back-end/src/util/integration";

import { addCaseWhenTimeFilter } from "back-end/src/integrations/sql/clauses/add-case-when-time-filter";
import { addHours } from "back-end/src/integrations/sql/primitives/add-hours";
import { getBanditCaseWhen } from "back-end/src/integrations/sql/clauses/bandit-case-when";
import { getBanditDates } from "back-end/src/integrations/sql/clauses/bandit-variation-period-weights";
import { getBanditStatisticsFactMetricCTE } from "back-end/src/integrations/sql/ctes/bandit-statistics-fact-metric-cte";
import { getDimensionCol } from "back-end/src/integrations/sql/columns/dimension-col";
import { getExperimentEndDate } from "back-end/src/integrations/sql/dates/experiment-end-date";
import { getExperimentFactMetricStatisticsCTE } from "back-end/src/integrations/sql/ctes/experiment-fact-metric-statistics-cte";
import { getExperimentUnitsQuery } from "back-end/src/integrations/sql/queries/experiment-units-query";
import { getFactMetricCTE } from "back-end/src/integrations/sql/ctes/fact-metric-cte";
import { getFactMetricQuantileData } from "back-end/src/integrations/sql/columns/fact-metric-quantile-data";
import { getFactTablesForMetrics } from "back-end/src/integrations/sql/fact-metrics/fact-tables-for-metrics";
import { getIdentitiesCTE } from "back-end/src/integrations/sql/ctes/identities-cte";
import { getMetricData } from "back-end/src/integrations/sql/fact-metrics/metric-data";
import { processActivationMetric } from "back-end/src/integrations/sql/processing/process-activation-metric";
import { processDimensions } from "back-end/src/integrations/sql/processing/process-dimensions";
import { appendContextualBanditTargetingAttributeCols } from "back-end/src/integrations/sql/ctes/contextual-bandit-experiment-units-cte";
import { getQuantileGridColumns } from "back-end/src/integrations/sql/columns/quantile-grid-columns";
import { getQuantileSketchGridColumns } from "back-end/src/integrations/sql/columns/quantile-sketch-grid-columns";

export function getExperimentFactMetricsQuery(
  dialect: SqlDialect,
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
    dialect,
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

  const factTableLabel = `${
    factTablesWithIndices.length === 1
      ? `Fact Table`
      : `Cross-Fact Table Metrics`
  }: ${factTablesWithIndices.map((f) => f.factTable.name).join(" & ")}`;
  const dimensionLabel = unitDimensions.length
    ? `Dimension: ${unitDimensions.map((d) => d.dimension.name).join(", ")}; `
    : "";
  const queryName = `${dimensionLabel}${factTableLabel}`;

  const userIdType = params.unitsSettings.exposureQuery.userIdType;
  if (!userIdType) {
    throw new Error("Unable to determine user id type from exposureQuery");
  }

  const metricData = metricsWithIndices.map((metric) =>
    getMetricData(
      dialect,
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
  const endDate: Date = getExperimentEndDate(settings, maxHoursToConvert);

  const banditDates = getBanditDates(settings.banditSettings);

  const dimensionCols: DimensionColumnData[] = params.dimensions.map((d) =>
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

  appendContextualBanditTargetingAttributeCols(dimensionCols, settings);

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
      `${timestampColumn} <= ${dialect.toTimestamp(endDate)}`,
    );
  }

  // TODO(sql): refactor so this is a property of the source table itself
  const percentileTableIndices = new Set<number>();
  const percentileData: FactMetricPercentileData[] = [];
  const ignoreZerosFor = (m: (typeof metricData)[number]) =>
    m.metric.cappingSettings.ignoreZeros ?? false;
  metricData
    .filter(
      (m) =>
        isUpperPercentileCappedMetric(m.metric) ||
        isLowerPercentileCappedMetric(m.metric),
    )
    .forEach((m) => {
      if (isUpperPercentileCappedMetric(m.metric)) {
        percentileData.push({
          valueCol: `${m.alias}_value`,
          outputCol: `${m.alias}_value_cap`,
          percentile: m.metric.cappingSettings.value ?? 1,
          ignoreZeros: ignoreZerosFor(m),
          sourceIndex: m.numeratorSourceIndex,
        });
        percentileTableIndices.add(m.numeratorSourceIndex);
        if (m.ratioMetric) {
          percentileData.push({
            valueCol: `${m.alias}_denominator`,
            outputCol: `${m.alias}_denominator_cap`,
            percentile: m.metric.cappingSettings.value ?? 1,
            ignoreZeros: ignoreZerosFor(m),
            sourceIndex: m.denominatorSourceIndex,
          });
          percentileTableIndices.add(m.denominatorSourceIndex);
        }
      }
      if (isLowerPercentileCappedMetric(m.metric)) {
        const lower = m.metric.lowerCappingSettings;
        const lowerIgnoreZeros = lower?.ignoreZeros ?? false;
        percentileData.push({
          valueCol: `${m.alias}_value`,
          outputCol: `${m.alias}_value_cap_lower`,
          percentile: lower?.value ?? 0,
          ignoreZeros: lowerIgnoreZeros,
          sourceIndex: m.numeratorSourceIndex,
        });
        percentileTableIndices.add(m.numeratorSourceIndex);
        if (m.ratioMetric) {
          percentileData.push({
            valueCol: `${m.alias}_denominator`,
            outputCol: `${m.alias}_denominator_cap_lower`,
            percentile: lower?.value ?? 0,
            ignoreZeros: lowerIgnoreZeros,
            sourceIndex: m.denominatorSourceIndex,
          });
          percentileTableIndices.add(m.denominatorSourceIndex);
        }
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
    ${raMetricSettings
      .map(
        ({ alias, hours, minDelay }) => `
            , ${addHours(
              dialect,
              "first_exposure_timestamp",
              minDelay,
            )} AS ${alias}_preexposure_end
            , ${addHours(
              dialect,
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
      .map((f) => {
        const suffix = f.index === 0 ? "" : f.index;
        const userMetricJoinTable = `__userMetricJoin${suffix}`;
        const userMetricAggBaseTable = `__userMetricAggBase${suffix}`;
        const userMetricAggTable = `__userMetricAgg${suffix}`;
        const eventQuantileMetricTable = `__eventQuantileMetric${suffix}`;

        const factTableKllMergeMetrics = metricData.filter(
          (d) =>
            d.metric.numerator.aggregation === "kll merge" &&
            d.numeratorSourceIndex === f.index,
        );
        const hasKllMerge = factTableKllMergeMetrics.length > 0;
        const hasEventQuantile = eventQuantileData.length > 0;
        const hasNonKllEventQuantile = eventQuantileData.some(
          (d) => !d.isKllMerge,
        );
        // KLL is mergeable: merge(per-event sketches) ≡ merge(per-user merged
        // sketches). When every event-quantile metric is 'kll merge', read
        // the variation-level merge from the per-user sketches in
        // __userMetricAggBase instead of re-scanning per-event values in
        // __userMetricJoin — same shape as __eventQuantileSketch +
        // __eventQuantileMetric in the incremental-refresh path in
        // SqlIntegration.ts. Mixed cases still read per-event from
        // __userMetricJoin because non-KLL APPROX_PERCENTILE needs per-event
        // values and we only emit a single __eventQuantileMetric CTE.
        const eqmReadsFromBase =
          hasKllMerge && !hasNonKllEventQuantile && hasEventQuantile;

        // Per-user aggregation body — shared between __userMetricAggBase
        // (when emitted) and __userMetricAgg (when no KLL merge wrapper is
        // needed).
        //
        // Notes on what this SELECT emits per metric:
        //   - 'kll merge' numerator: a per-user sketch column
        //     <alias>_user_sketch via kllMergePartial. The scalar
        //     <alias>_value is computed post-GROUP-BY in __userMetricAgg
        //     because kllRankApprox needs the per-user sketch AND the
        //     variation-level quantile (BigQuery/Snowflake handle scalar
        //     subqueries with outer-aggregate references inside a GROUP BY
        //     inconsistently, so the rank recovery is done after the join).
        //   - non-KLL numerator: a per-user <alias>_value via
        //     aggregatedValueTransformation; non-KLL event-quantile metrics
        //     reference qm.<alias>_quantile per-event so they require the
        //     LEFT JOIN to __eventQuantileMetric below.
        //   - <alias>_n_events: SUM of the paired count column for kll
        //     merge (since each row is a pre-aggregated sketch covering many
        //     events) and COUNT(rows) otherwise.
        const perUserAggSelect = `
          -- Add in the aggregate metric value for each user
          SELECT
            umj.variation
            ${dimensionCols
              .map((c) => `, umj.${c.alias} AS ${c.alias}`)
              .join("")}
            ${banditDates?.length ? `, umj.bandit_period` : ""}
            , umj.${baseIdType}
            ${metricData
              .map((data) => {
                const isKllMergeNumerator =
                  data.metric.numerator.aggregation === "kll merge" &&
                  data.numeratorSourceIndex === f.index;

                const kllMergeColumns = isKllMergeNumerator
                  ? `, ${dialect.quantileSketchMergePartial(`umj.${data.alias}_value`)} AS ${data.alias}_user_sketch`
                  : "";

                const numeratorValueColumn =
                  data.numeratorSourceIndex === f.index && !isKllMergeNumerator
                    ? `, ${data.aggregatedValueTransformation({
                        column: data.numeratorAggFns.fullAggregationFunction(
                          `umj.${data.alias}_value`,
                          `qm.${data.alias}_quantile`,
                        ),
                        initialTimestampColumn: "MIN(umj.timestamp)",
                        analysisEndDate: params.settings.endDate,
                      })} AS ${data.alias}_value`
                    : "";

                return `${numeratorValueColumn}${kllMergeColumns}
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
              .map((data) =>
                data.isKllMerge
                  ? `, SUM(COALESCE(umj.${data.alias}_n_events, 0)) AS ${data.alias}_n_events`
                  : `, COUNT(umj.${data.alias}_value) AS ${data.alias}_n_events`,
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
            ${userMetricJoinTable} umj
          ${
            // Non-KLL event-quantile metrics need the variation-level
            // quantile joined per-event so aggregatedValueTransformation can
            // reference qm.<alias>_quantile during the per-user GROUP BY.
            // KLL-only paths avoid this join — the per-user sketch carries
            // enough information and resolution happens in __userMetricAgg.
            hasNonKllEventQuantile
              ? `
          LEFT JOIN ${eventQuantileMetricTable} qm
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
        `;

        // __eventQuantileMetric: per (variation, dimension) quantile grid for
        // event-quantile metrics. Raw event-quantile metrics use
        // APPROX_PERCENTILE over per-event numeric values in
        // __userMetricJoin. 'kll merge' metrics merge sketches via
        // KLL_QUANTILES.MERGE_PARTIAL and read off quantile + bound points
        // via KLL_QUANTILES.EXTRACT_POINT. When eqmReadsFromBase, the merge
        // operand is the per-user sketch from __userMetricAggBase (so
        // __userMetricJoin is scanned exactly once); otherwise it's the
        // per-event sketch from __userMetricJoin.
        const eventQuantileMetricCte = hasEventQuantile
          ? `
      , ${eventQuantileMetricTable} AS (
        SELECT
        m.variation AS variation
        ${dimensionCols.map((c) => `, m.${c.alias} AS ${c.alias}`).join("")}
        ${eventQuantileData
          .map((data) =>
            data.isKllMerge
              ? getQuantileSketchGridColumns(
                  dialect,
                  data.metricQuantileSettings,
                  dialect.quantileSketchMergePartial(
                    eqmReadsFromBase
                      ? `m.${data.alias}_user_sketch`
                      : `m.${data.alias}_value`,
                  ),
                  `${data.alias}_`,
                )
              : getQuantileGridColumns(
                  dialect,
                  data.metricQuantileSettings,
                  `${data.alias}_`,
                ),
          )
          .join("\n")}
      FROM
        ${eqmReadsFromBase ? userMetricAggBaseTable : userMetricJoinTable} m
      GROUP BY
        m.variation
        ${dimensionCols.map((c) => `, m.${c.alias}`).join("")}
      )`
          : "";

        // __userMetricAggBase: per-user aggregation. Only emitted when
        // there are KLL merge metrics — its only consumer is __userMetricAgg
        // (and __eventQuantileMetric when eqmReadsFromBase). Without KLL
        // merge metrics the per-user aggregation goes directly into
        // __userMetricAgg.
        const userMetricAggBaseCte = hasKllMerge
          ? `
      , ${userMetricAggBaseTable} as (${perUserAggSelect})`
          : "";

        // __userMetricAgg: final per-user values consumed by downstream
        // statistics CTEs.
        //   - With KLL merge: thin wrapper that joins __userMetricAggBase
        //     against __eventQuantileMetric to apply kllRankApprox
        //     post-GROUP-BY (recovers the per-user "count below threshold"
        //     using the per-user sketch and the variation-level quantile).
        //   - Without KLL merge: just the per-user aggregation directly.
        const kllMergeResolutionCols = factTableKllMergeMetrics
          .map(
            (data) =>
              `, ${dialect.quantileSketchRankApprox(
                `base.${data.alias}_user_sketch`,
                `qm.${data.alias}_quantile`,
                `base.${data.alias}_n_events`,
                100,
              )} AS ${data.alias}_value`,
          )
          .join("\n");
        const userMetricAggCte = hasKllMerge
          ? `
      , ${userMetricAggTable} as (
        SELECT base.* ${kllMergeResolutionCols}
        FROM ${userMetricAggBaseTable} base
        LEFT JOIN ${eventQuantileMetricTable} qm
        ON (qm.variation = base.variation ${dimensionCols
          .map((c) => `AND qm.${c.alias} = base.${c.alias}`)
          .join("\n")})
      )`
          : `
      , ${userMetricAggTable} as (${perUserAggSelect})`;

        // CTE order depends on the dependency graph:
        //   - eqmReadsFromBase (KLL only): join → base → eqm → agg
        //   - mixed KLL + non-KLL event quantile: join → eqm → base → agg
        //   - non-KLL event quantile only: join → eqm → agg (no base)
        //   - no event quantile: join → agg (no base, no eqm)
        const downstreamCtes = eqmReadsFromBase
          ? `${userMetricAggBaseCte}${eventQuantileMetricCte}${userMetricAggCte}`
          : `${eventQuantileMetricCte}${userMetricAggBaseCte}${userMetricAggCte}`;

        return `, __factTable${suffix} as (
        ${getFactMetricCTE(dialect, {
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
      , ${userMetricJoinTable} as (
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
                    ? `, ${addCaseWhenTimeFilter(dialect, {
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
                    ? `, ${addCaseWhenTimeFilter(dialect, {
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
                ${
                  data.metric.numerator.aggregation === "kll merge" &&
                  data.numeratorSourceIndex === f.index
                    ? `, ${addCaseWhenTimeFilter(dialect, {
                        col: `m.${data.alias}_n_events`,
                        metric: data.metric,
                        overrideConversionWindows:
                          data.overrideConversionWindows,
                        endDate: settings.endDate,
                        // Skip ignoreZeros for n_events
                        metricQuantileSettings: {
                          ...data.metricQuantileSettings,
                          ignoreZeros: false,
                        },
                        metricTimestampColExpr: "m.timestamp",
                        exposureTimestampColExpr: "d.timestamp",
                      })} as ${data.alias}_n_events`
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
                          ? `, ${dialect.ifElse(
                              `m.timestamp >= d.${metric.alias}_preexposure_start AND m.timestamp < d.${metric.alias}_preexposure_end`,
                              `m.${metric.alias}_value`,
                              "NULL",
                            )} AS ${metric.alias}_covariate_value`
                          : ""
                      }${
                        metric.ratioMetric &&
                        metric.denominatorSourceIndex === f.index
                          ? `, ${dialect.ifElse(
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
        LEFT JOIN __factTable${suffix} m ON (
          m.${baseIdType} = d.${baseIdType}
        )
      )${downstreamCtes}
    ${
      percentileTableIndices.has(f.index)
        ? `
      , __capValue${suffix} AS (
          ${dialect.percentileCapSelectClause(
            percentileData.filter((p) => p.sourceIndex === f.index),
            userMetricAggTable,
          )}
      )
      `
        : ""
    }
    `;
      })
      .join("\n")}    
    ${
      banditDates?.length
        ? getBanditStatisticsFactMetricCTE(dialect, {
            baseIdType,
            metricData,
            dimensionCols,
            factTablesWithIndices,
            regressionAdjustedTableIndices,
            percentileTableIndices,
          })
        : `
    -- One row per variation/dimension with aggregations
    ${getExperimentFactMetricStatisticsCTE(dialect, {
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
    dialect.formatDialect,
  );
}
