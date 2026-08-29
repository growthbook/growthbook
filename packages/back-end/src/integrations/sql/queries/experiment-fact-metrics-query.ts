import cloneDeep from "lodash/cloneDeep";
import { isFunnelSupportedDatasourceType } from "shared/enterprise";
import { getUserIdTypes, isFactFunnelMetric } from "shared/experiments";
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
import {
  FunnelMetricForResolution,
  FunnelMetricSteps,
  funnelStep0NeedsExposureWindow,
  getFunnelResolutionCTEs,
  getFunnelUserMetricAggColumns,
} from "back-end/src/integrations/sql/ctes/funnel-resolution-cte";
import { getFlattenedUnitMetricsCTE } from "back-end/src/integrations/sql/ctes/flattened-unit-metrics-cte";
import {
  AggColumn,
  renderAggColumns,
} from "back-end/src/integrations/sql/columns/agg-column";
import {
  funnelStepArrayColumn,
  funnelStepResolvedTsColumn,
  funnelStepTimestampColumn,
} from "back-end/src/integrations/sql/fact-metrics/funnel-columns";
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

  // Throw noisely instead of letting the dialect throw a generic
  // unsupported-operation error.
  if (!isFunnelSupportedDatasourceType(datasource.type)) {
    const unsupported = metricsWithIndices
      .filter((m) => isFactFunnelMetric(m.metric))
      .map((m) => m.metric.name);
    if (unsupported.length > 0) {
      throw new Error(
        `Funnel metrics are not supported for ${datasource.type} data sources (metric(s): ${unsupported.join(", ")})`,
      );
    }
  }

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

  const banditDates = getBanditDates(settings.banditSettings);
  const hasFunnelMetrics = metricsWithIndices.some((m) =>
    isFactFunnelMetric(m.metric),
  );
  // The bandit statistics CTE has no funnel handling; the UI blocks the
  // combination, this is the backstop.
  if (hasFunnelMetrics && banditDates?.length) {
    throw new Error("Funnel metrics are not supported in Bandit experiments");
  }
  // Funnel steps can only be windowed against each other once every candidate
  // timestamp sits on one row, so multi-table sources are flattened into
  // __unitMetricsBase and the per-source `m{i}` aliases collapse to `m`.
  const flattenUnitMetrics =
    hasFunnelMetrics && factTablesWithIndices.length > 1;

  const metricData = metricsWithIndices.map((metric) =>
    getMetricData(
      dialect,
      metric,
      settings,
      activationMetric,
      factTablesWithIndices,
      "m",
      `m${metric.index}`,
      flattenUnitMetrics,
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
  const idTypeObjects = [
    [userIdType],
    ...factTablesWithIndices.map((f) => f.factTable.userIdTypes || []),
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
  const endDate: Date = getExperimentEndDate(settings, maxHoursToConvert);

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
  // Event quantile columns are emitted under one unqualified name per source,
  // so they cannot span sources; grouping already guarantees this.
  if (eventQuantileData.length && factTablesWithIndices.length > 1) {
    throw new Error(
      "ImplementationError: event quantile metrics are not supported across multiple fact tables",
    );
  }

  if (
    params.dimensions.length > 1 &&
    metricData.some((m) => !!m.quantileMetric)
  ) {
    throw new Error(
      "ImplementationError: quantile metrics are not supported with pre-computed dimension breakdowns",
    );
  }

  const funnelMetrics: FunnelMetricForResolution[] = metricData.flatMap((d) =>
    isFactFunnelMetric(d.metric) ? [{ metric: d.metric, alias: d.alias }] : [],
  );
  const userMetricAggTablePrefix = "__userMetricAgg";
  const unitMetricsBaseTable = "__unitMetricsBase";
  const unitMetricsTable = "__unitMetrics";
  const funnelResolutionSource = flattenUnitMetrics
    ? unitMetricsBaseTable
    : userMetricAggTablePrefix;
  // Resolution's terminal CTE carries every metric column, so statistics read
  // it whole; without funnels there is no chain.
  const statisticsSourceTable = funnelMetrics.length
    ? unitMetricsTable
    : userMetricAggTablePrefix;

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

  const funnelStepsForSource = (sourceIndex: number): FunnelMetricSteps[] =>
    metricData.flatMap((d) => {
      if (!isFactFunnelMetric(d.metric)) return [];
      const stepIndices = d.funnelStepSourceIndices.flatMap(
        (stepSourceIndex, stepIndex) =>
          stepSourceIndex === sourceIndex ? [stepIndex] : [],
      );
      return stepIndices.length
        ? [{ metric: d.metric, alias: d.alias, stepIndices }]
        : [];
    });

  const kllMergeMetricsForSource = (sourceIndex: number) =>
    metricData.filter(
      (d) =>
        d.metric.numerator?.aggregation === "kll merge" &&
        d.numeratorSourceIndex === sourceIndex,
    );

  // Metric columns a source's per-user aggregate emits.
  const getSourceAggMetricColumns = (sourceIndex: number): AggColumn[] => {
    const columns: AggColumn[] = [];

    metricData.forEach((data) => {
      const isKllMergeNumerator =
        data.metric.numerator?.aggregation === "kll merge" &&
        data.numeratorSourceIndex === sourceIndex;

      if (isKllMergeNumerator) {
        columns.push({
          name: `${data.alias}_user_sketch`,
          expr: dialect.quantileSketchMergePartial(`umj.${data.alias}_value`),
        });
      } else if (
        data.numeratorSourceIndex === sourceIndex &&
        !isFactFunnelMetric(data.metric)
      ) {
        columns.push({
          name: `${data.alias}_value`,
          expr: data.aggregatedValueTransformation({
            column: data.numeratorAggFns.fullAggregationFunction(
              `umj.${data.alias}_value`,
              `qm.${data.alias}_quantile`,
            ),
            initialTimestampColumn: "MIN(umj.timestamp)",
            analysisEndDate: params.settings.endDate,
          }),
        });
      }

      if (data.ratioMetric && data.denominatorSourceIndex === sourceIndex) {
        columns.push({
          name: `${data.alias}_denominator`,
          expr: data.aggregatedValueTransformation({
            column: data.denominatorAggFns.fullAggregationFunction(
              `umj.${data.alias}_denominator`,
              `qm.${data.alias}_quantile`,
            ),
            initialTimestampColumn: "MIN(umj.timestamp)",
            analysisEndDate: params.settings.endDate,
          }),
        });
      }
    });

    eventQuantileData.forEach((data) => {
      columns.push({
        name: `${data.alias}_n_events`,
        expr: data.isKllMerge
          ? `SUM(COALESCE(umj.${data.alias}_n_events, 0))`
          : `COUNT(umj.${data.alias}_value)`,
      });
    });

    columns.push(
      ...getFunnelUserMetricAggColumns(
        dialect,
        funnelStepsForSource(sourceIndex),
      ),
    );

    if (regressionAdjustedTableIndices.has(sourceIndex)) {
      regressionAdjustedMetrics.forEach((metric) => {
        if (metric.numeratorSourceIndex === sourceIndex) {
          columns.push({
            name: `${metric.alias}_covariate_value`,
            expr: metric.covariateNumeratorAggFns.fullAggregationFunction(
              `umj.${metric.alias}_covariate_value`,
            ),
          });
        }
        if (
          metric.ratioMetric &&
          metric.denominatorSourceIndex === sourceIndex
        ) {
          columns.push({
            name: `${metric.alias}_covariate_denominator`,
            expr: metric.covariateDenominatorAggFns.fullAggregationFunction(
              `umj.${metric.alias}_covariate_denominator`,
            ),
          });
        }
      });
    }

    return columns;
  };

  // 'kll merge' metrics recover their scalar value in the __userMetricAgg
  // wrapper, after the per-user GROUP BY, so those columns are not part of the
  // aggregate select above.
  const getSourceKllResolvedColumns = (sourceIndex: number): AggColumn[] =>
    kllMergeMetricsForSource(sourceIndex).map((data) => ({
      name: `${data.alias}_value`,
      expr: dialect.quantileSketchRankApprox(
        `base.${data.alias}_user_sketch`,
        `qm.${data.alias}_quantile`,
        `base.${data.alias}_n_events`,
        100,
      ),
    }));

  // Computed once per source so the rendered CTEs and every downstream
  // projection read the same names and can't drift.
  const sourceColumnsByIndex = new Map(
    factTablesWithIndices.map((f) => [
      f.index,
      {
        agg: getSourceAggMetricColumns(f.index),
        kllResolved: getSourceKllResolvedColumns(f.index),
      },
    ]),
  );
  const columnsForSource = (sourceIndex: number) =>
    sourceColumnsByIndex.get(sourceIndex) ?? { agg: [], kllResolved: [] };
  const columnNamesForSource = (sourceIndex: number) => {
    const { agg, kllResolved } = columnsForSource(sourceIndex);
    return [...agg, ...kllResolved].map((c) => c.name);
  };

  // Source 0 drives the flattened join and arrives via `m.*`.
  const flattenedSourceColumns = flattenUnitMetrics
    ? factTablesWithIndices
        .filter((f) => f.index !== 0)
        .map((f) => ({
          index: f.index,
          columns: columnNamesForSource(f.index),
        }))
    : [];

  // Candidate arrays and the step-0 MIN stop at the resolution chain; the
  // terminal CTE re-projects resolved timestamps itself.
  const funnelWorkingColumnNames = new Set(
    funnelMetrics.flatMap(({ metric, alias }) =>
      metric.funnelSettings.steps.map((_step, stepIndex) =>
        stepIndex > 0 || funnelStep0NeedsExposureWindow(metric)
          ? funnelStepArrayColumn(alias, stepIndex)
          : funnelStepResolvedTsColumn(alias, 0),
      ),
    ),
  );
  const funnelPassthroughColumns = [
    "variation",
    ...dimensionCols.map((c) => c.alias),
    baseIdType,
    "timestamp",
    ...factTablesWithIndices.flatMap((f) => columnNamesForSource(f.index)),
  ].filter((name) => !funnelWorkingColumnNames.has(name));

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
        const userMetricAggTable = `${userMetricAggTablePrefix}${suffix}`;
        const eventQuantileMetricTable = `__eventQuantileMetric${suffix}`;

        const factTableFunnelMetrics = funnelStepsForSource(f.index);
        const hasKllMerge = columnsForSource(f.index).kllResolved.length > 0;
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
            ${banditDates?.length ? `, umj.bandit_period` : ""}            , umj.${baseIdType}
            ${
              // Funnel resolution anchors exposure-relative windows on this;
              // source 0 drives the per-unit table.
              hasFunnelMetrics && f.index === 0
                ? `, MIN(umj.timestamp) AS timestamp`
                : ""
            }
            ${renderAggColumns(columnsForSource(f.index).agg)}
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
            ${banditDates?.length ? `, umj.bandit_period` : ""}            , umj.${baseIdType}
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
        const userMetricAggCte = hasKllMerge
          ? `
      , ${userMetricAggTable} as (
        SELECT base.* ${renderAggColumns(columnsForSource(f.index).kllResolved)}
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
          ${
            // Pass through event_timestamp to enable certain dialects (Redshift)
            // to order by it for array sorting
            factTableFunnelMetrics.length
              ? `, m.timestamp AS event_timestamp`
              : ""
          }
          ${dimensionCols.map((c) => `, d.${c.alias} AS ${c.alias}`).join("")}
          ${banditDates?.length ? `, d.bandit_period AS bandit_period` : ""}
          , d.${baseIdType} AS ${baseIdType}
          ${metricData
            .map(
              (data) =>
                `${
                  data.numeratorSourceIndex === f.index &&
                  !isFactFunnelMetric(data.metric)
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
                  data.metric.numerator?.aggregation === "kll merge" &&
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
                ${
                  isFactFunnelMetric(data.metric)
                    ? data.metric.funnelSettings.steps
                        .flatMap((_step, stepIndex) => {
                          if (
                            data.funnelStepSourceIndices[stepIndex] !== f.index
                          ) {
                            return [];
                          }
                          const col = funnelStepTimestampColumn(
                            data.alias,
                            stepIndex,
                          );
                          // This case when applies the overall conversion window.
                          // Step-specific conversion windows are applied later.
                          return [
                            `, ${addCaseWhenTimeFilter(dialect, {
                              col: `m.${col}`,
                              metric: data.metric,
                              overrideConversionWindows:
                                data.overrideConversionWindows,
                              endDate: settings.endDate,
                              metricTimestampColExpr: "m.timestamp",
                              exposureTimestampColExpr: "d.timestamp",
                            })} as ${col}`,
                          ];
                        })
                        .join("\n")
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
      flattenUnitMetrics
        ? getFlattenedUnitMetricsCTE({
            tableName: unitMetricsBaseTable,
            perUserAggTableName: userMetricAggTablePrefix,
            sourceColumns: flattenedSourceColumns,
            baseIdType,
          })
        : ""
    }
    ${
      // Resolution runs once per query, not per fact table: steps can only be
      // windowed against a predecessor once every candidate is on one row.
      funnelMetrics.length
        ? getFunnelResolutionCTEs(dialect, {
            funnelMetrics,
            sourceTableName: funnelResolutionSource,
            terminalTableName: unitMetricsTable,
            resolveTablePrefix: "__funnelResolve_",
            exposureColumn: "timestamp",
            sourcePassthroughColumns: funnelPassthroughColumns,
          })
        : ""
    }
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
      joinedMetricTableName: userMetricAggTablePrefix,
      statisticsSourceTableName: statisticsSourceTable,
      flattenedSources: flattenUnitMetrics,
      funnelsResolvedOnSource: funnelMetrics.length > 0,
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
