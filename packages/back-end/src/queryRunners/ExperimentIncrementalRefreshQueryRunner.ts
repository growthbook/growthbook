import type { QueryRunnerFailureCause } from "shared/types/query";
import {
  ExperimentMetricInterface,
  getClusterSubUnit,
  getFactMetricFactTableIds,
  getIsolatedDimensionIds,
  getNewMetricsUpdate,
  isFactMetric,
  isRegressionAdjusted,
  quantileMetricType,
} from "shared/experiments";
import { PRECOMPUTED_DIMENSION_PREFIX } from "shared/constants";
import cloneDeep from "lodash/cloneDeep";
import isEqual from "lodash/isEqual";
import { SegmentInterface } from "shared/types/segment";
import {
  IncrementalRefreshInterface,
  IncrementalRefreshMetricCovariateSourceInterface,
  IncrementalRefreshMetricSourceInterface,
} from "shared/validators";
import {
  ExperimentDimensionWithSpecifiedSlices,
  ExternalIdCallback,
  InsertMetricSourceDataQueryParams,
  UpdateExperimentIncrementalUnitsQueryParams,
} from "shared/types/integrations";
import {
  ExperimentSnapshotInterface,
  ExperimentSnapshotSettings,
  SnapshotType,
} from "shared/types/experiment-snapshot";
import {
  resolveExposureQueryForAnalysis,
  buildUnitsQuerySettingsFromSnapshot,
} from "shared/util";
import {
  ExperimentQueryMetadata,
  Queries,
  QueryPointer,
  QueryStatus,
  RunQueryMetadata,
} from "shared/types/query";
import { FactMetricInterface } from "shared/types/fact-table";
import { ApiReqContext } from "back-end/types/api";
import {
  errorSnapshotIfStillRunning,
  findSnapshotById,
  updateSnapshot,
} from "back-end/src/models/ExperimentSnapshotModel";
import { SourceIntegrationInterface } from "back-end/src/types/Integration";
import { FactTableMap } from "back-end/src/models/FactTableModel";
import { updateReport } from "back-end/src/models/ReportModel";
import { summarizeHealth } from "back-end/src/services/experimentResults/summarize/health";
import {
  getExperimentSettingsHashForIncrementalRefresh,
  getMetricSettingsHashForIncrementalRefresh,
  getMetricSettingsHashesForIncrementalRefresh,
  getFactTablesNeedingRebuild,
  assertIncrementalRefreshPrerequisites,
} from "back-end/src/enterprise/services/data-pipeline";
import { getExposureQueryEligibleDimensions } from "back-end/src/services/dimensions";
import {
  getQueryableMetricsFromSnapshotSettings,
  maxColumnsNeededForMetric,
} from "back-end/src/services/experimentQueries/experimentQueries";
import { planIncrementalCaches } from "back-end/src/services/experimentQueries/incrementalCachePlacement";
import {
  filterRegressionAdjustedMetrics,
  planMetricFanOut,
} from "back-end/src/services/experimentQueries/planMetricFanOut";
import { buildMultiSourceSubGroups } from "back-end/src/services/experimentQueries/multiSourceSubGroups";
import {
  conversionWindowMinutesKey,
  conversionWindowQueryNameSuffix,
  getOverriddenMetricConversionWindowHours,
  partitionMetricsByConversionWindow,
} from "back-end/src/services/experimentQueries/partitionMetricsByConversionWindow";
import { resolveCovariateInsertPath } from "back-end/src/integrations/sql/fact-metrics/resolve-covariate-insert-path";
import {
  resolveClusterMetricGrain,
  getClusterMetricCacheLevel,
} from "back-end/src/integrations/sql/fact-metrics/cluster-metric-grain";
import { rawWatermark } from "back-end/src/integrations/sql/primitives/watermark";
import { ExperimentUpdateExecutionLogger } from "back-end/src/services/experimentUpdateExecutionLogger";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { applyMetricOverrides } from "back-end/src/util/integration";
import { analyzeSnapshotResults } from "back-end/src/services/experimentResults/compute/analyzeSnapshot";
import {
  getNewMetricsUpdateQueryStatus,
  getNewMetricsUpdateStartQuery,
} from "back-end/src/services/experimentResults/query/newMetricsUpdateQueries";
import { SnapshotResult } from "./ExperimentResultsQueryRunner";
import {
  QueryRunner,
  QueryMap,
  ProcessedRowsType,
  RowsType,
  StartQueryParams,
} from "./QueryRunner";
import { shouldRunHealthTrafficQuery } from "./snapshotQueryHelpers";
import { getUnitDimQueryName } from "./unitDimensionQueryNaming";
import {
  CLUSTER_HEALTH_QUERY_NAME,
  CLUSTER_TRAFFIC_QUERY_NAME,
  STATISTICS_QUERY_PREFIX,
  TRAFFIC_QUERY_NAME,
} from "./experimentQueryNaming";

export const INCREMENTAL_UNITS_TABLE_PREFIX = "gb_units";
export const INCREMENTAL_METRICS_TABLE_PREFIX = "gb_metrics";
export const INCREMENTAL_CUPED_TABLE_PREFIX = "gb_cuped";

const getRandomTableSuffix = () => Math.random().toString(36).substring(2, 10);

function tableNameFromFullName(fullName: string) {
  const segments = fullName.replace(/`/g, "").split(".");
  return segments[segments.length - 1];
}

export function getStatisticsQueryVariants({
  baseName,
  breakdownsDisabled,
  parentFanOutDisabled,
  parentPrecomputedDimensions,
  isolatedPrecomputedDimensions,
}: {
  baseName: string;
  breakdownsDisabled: boolean;
  parentFanOutDisabled: boolean;
  parentPrecomputedDimensions: ExperimentDimensionWithSpecifiedSlices[];
  isolatedPrecomputedDimensions: ExperimentDimensionWithSpecifiedSlices[];
}): {
  name: string;
  dimensionsForPrecomputation: ExperimentDimensionWithSpecifiedSlices[];
}[] {
  if (breakdownsDisabled) {
    return [{ name: baseName, dimensionsForPrecomputation: [] }];
  }
  const parentDimensions = parentFanOutDisabled
    ? []
    : parentPrecomputedDimensions;
  return [
    {
      name: baseName,
      dimensionsForPrecomputation: parentDimensions,
    },
    ...isolatedPrecomputedDimensions.map((d) => ({
      name: getUnitDimQueryName(
        `${PRECOMPUTED_DIMENSION_PREFIX}${d.id}`,
        baseName,
      ),
      dimensionsForPrecomputation: [d],
    })),
  ];
}

export type IncrementalRunMode = { kind: "full" } | { kind: "update" };

export type ExperimentIncrementalRefreshQueryParams = {
  snapshotType: SnapshotType;
  snapshotSettings: ExperimentSnapshotSettings;
  variationNames: string[];
  metricMap: Map<string, ExperimentMetricInterface>;
  factTableMap: FactTableMap;
  queryParentId: string;
  experimentId: string;
  experimentQueryMetadata: ExperimentQueryMetadata | null;
  // Incremental Refresh specific
  mode: IncrementalRunMode;
  incrementalRefreshStartTime: Date;
};

// TODO(incremental-refresh): add metrics to existing metric source to force recreating the whole thing.
// UI side to let the user know a refresh will trigger restating the whole metric source.
export interface MetricSourceGroups {
  groupId: string;
  factTableId: string;
  // Metrics that live in this source. A cross-FT ratio metric appears in
  // BOTH of its fact tables' groups (once on the numerator side, once on
  // the denominator side); schema gen / insert SQL derive which side this
  // cache materializes by comparing the metric's column refs to
  // `factTableId`.
  metrics: FactMetricInterface[];
  // The stored source this group rebuilds with more metrics, under a new id.
  replacesGroupId: string | null;
}

export function getIncrementalRefreshMetricSources({
  metrics,
  existingMetricSources,
  extendExistingSources,
  integration,
  snapshotSettings,
}: {
  metrics: FactMetricInterface[];
  existingMetricSources: IncrementalRefreshInterface["metricSources"];
  // Place a metric without a cache in the smallest stored source of its kind
  // that has room, instead of only in new sources.
  extendExistingSources: boolean;
  integration: SourceIntegrationInterface;
  snapshotSettings: ExperimentSnapshotSettings;
}): MetricSourceGroups[] {
  // Apply overrides once so grouping, cache insert, and the read-time cutoff
  // all use the same values.
  // TODO(overrides): hoist to the start of analysis so query builders can stop re-applying.
  const overriddenMetrics = metrics.map((metric) => {
    const clone = cloneDeep(metric);
    applyMetricOverrides(clone, snapshotSettings);
    return clone;
  });

  // Fan-out determines each metric's fact tables; this only places their caches.
  const fanOut = planMetricFanOut(overriddenMetrics);

  // Cluster-level metrics can't share a cache with user-level metrics even on
  // the same fact table. Mirrors the `cluster:${group}` partitioning in
  // experimentQueries.
  const clusterLevelMetricIds = new Set(
    getClusterSubUnit(snapshotSettings)
      ? (snapshotSettings.clusterLevelMetricIds ?? [])
      : [],
  );

  // One cache per table (except quantiles which have their own cache).
  // Mirrors experimentQueries grouping rules.
  const getMetricGroupKey = (
    factTableId: string,
    metric: FactMetricInterface,
  ) =>
    `${
      clusterLevelMetricIds.has(metric.id) ? "cluster_" : ""
    }${factTableId}${quantileMetricType(metric) ? "_qtile" : ""}`;

  const sourceProps = integration.getSourceProperties();
  const toCacheMetric = (factTableId: string, metric: FactMetricInterface) => ({
    metricId: metric.id,
    cacheKind: getMetricGroupKey(factTableId, metric),
    columns: maxColumnsNeededForMetric({
      metric,
      regressionAdjusted:
        isRegressionAdjusted(metric) &&
        snapshotSettings.regressionAdjustmentEnabled,
      isBandit: !!snapshotSettings.banditSettings,
      efficientQuantileGrid: !!sourceProps.hasArrayQuantileGrid,
    }),
  });

  // Metrics that map to a pre-existing cache table — keyed by that source's
  // groupId. Matching is done by (factTableId, metric id): a cross-FT ratio
  // metric appears in two groups (one per FT), and each FT's existing source
  // only collides on its own side.
  const existingBuckets = new Map<
    string,
    { factTableId: string; metrics: FactMetricInterface[] }
  >();
  const unplaced: { factTableId: string; metric: FactMetricInterface }[] = [];

  fanOut.perFt.forEach(({ factTableId, metrics: ftMetrics }) => {
    ftMetrics.forEach((metric) => {
      const existingGroup = existingMetricSources.find(
        (s) =>
          s.factTableId === factTableId &&
          s.metrics.some((m) => m.id === metric.id),
      );

      if (existingGroup) {
        const bucket = existingBuckets.get(existingGroup.groupId) ?? {
          factTableId,
          metrics: [],
        };
        bucket.metrics.push(metric);
        existingBuckets.set(existingGroup.groupId, bucket);
        return;
      }
      unplaced.push({ factTableId, metric });
    });
  });

  // A source whose metrics span several kinds predates this rule; it takes
  // no new metrics.
  const storedCaches = extendExistingSources
    ? [...existingBuckets].flatMap(([groupId, bucket]) => {
        const cacheMetrics = bucket.metrics.map((m) =>
          toCacheMetric(bucket.factTableId, m),
        );
        const kinds = new Set(cacheMetrics.map((m) => m.cacheKind));
        return kinds.size === 1
          ? [{ groupId, cacheKind: [...kinds][0], metrics: cacheMetrics }]
          : [];
      })
    : [];
  const plannedCaches = planIncrementalCaches({
    metrics: unplaced.map(({ factTableId, metric }) =>
      toCacheMetric(factTableId, metric),
    ),
    storedCaches,
    maxColumns: sourceProps.maxColumns,
  });

  const placedMetrics = new Map<
    string,
    { factTableId: string; metric: FactMetricInterface }
  >();
  const placeKey = (cacheKind: string, metricId: string) =>
    `${cacheKind}|${metricId}`;
  [
    ...unplaced,
    ...[...existingBuckets.values()].flatMap(({ factTableId, metrics }) =>
      metrics.map((metric) => ({ factTableId, metric })),
    ),
  ].forEach((entry) =>
    placedMetrics.set(
      placeKey(
        getMetricGroupKey(entry.factTableId, entry.metric),
        entry.metric.id,
      ),
      entry,
    ),
  );

  const rebuiltGroupIds = new Set(
    plannedCaches.flatMap((cache) =>
      cache.replacesGroupId ? [cache.replacesGroupId] : [],
    ),
  );
  const finalGroups: MetricSourceGroups[] = [];

  existingBuckets.forEach((bucket, groupId) => {
    if (rebuiltGroupIds.has(groupId)) return;
    finalGroups.push({
      groupId,
      factTableId: bucket.factTableId,
      metrics: bucket.metrics,
      replacesGroupId: null,
    });
  });

  plannedCaches.forEach((cache, i) => {
    const entries = cache.metricIds.map((metricId) => {
      const entry = placedMetrics.get(placeKey(cache.cacheKind, metricId));
      if (!entry) {
        throw new Error(
          `Metric ${metricId} was placed in a ${cache.cacheKind} cache it doesn't map to`,
        );
      }
      return entry;
    });
    const randomId = Math.random().toString(36).substring(2, 15);
    finalGroups.push({
      groupId: `${cache.cacheKind}_${randomId}${i}`,
      factTableId: entries[0].factTableId,
      metrics: entries.map((e) => e.metric),
      replacesGroupId: cache.replacesGroupId,
    });
  });

  return finalGroups;
}

// MAX() is NULL on an empty table; both fields are null then.
function parseMaxTimestampRow(row: Record<string, unknown> | undefined): {
  maxTimestamp: Date | null;
  maxTimestampRaw: string | null;
} {
  const parsed = row?.max_timestamp
    ? new Date(row.max_timestamp as string)
    : null;
  const maxTimestamp =
    parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
  return {
    maxTimestamp,
    maxTimestampRaw: rawWatermark(maxTimestamp, row?.max_timestamp_raw),
  };
}

export const startExperimentIncrementalRefreshQueries = async (
  context: ApiReqContext,
  params: ExperimentIncrementalRefreshQueryParams & {
    isNewMetricsUpdate: boolean;
  },
  integration: SourceIntegrationInterface,
  startQuery: (
    params: StartQueryParams<RowsType, ProcessedRowsType>,
  ) => Promise<QueryPointer>,
  experimentUpdateExecutionLogger: ExperimentUpdateExecutionLogger | null,
): Promise<Queries> => {
  const {
    snapshotSettings,
    queryParentId,
    experimentId,
    metricMap,
    mode,
    isNewMetricsUpdate,
  } = params;
  // A new-metrics update reads every stored table as its parent left it and
  // writes only the caches it builds or rebuilds.
  const appendsToStoredTables = !isNewMetricsUpdate;

  const { org } = context;

  const activationMetric = snapshotSettings.activationMetric
    ? (metricMap.get(snapshotSettings.activationMetric) ?? null)
    : null;

  let segmentObj: SegmentInterface | null = null;
  if (snapshotSettings.segment) {
    segmentObj = await context.models.segments.getById(
      snapshotSettings.segment,
    );
    if (!segmentObj) {
      throw new Error(
        `The experiment's segment (${snapshotSettings.segment}) could not be found. Update the experiment's segment and run a Full Refresh.`,
      );
    }
  }

  const settings = integration.datasource.settings;

  // Only include metrics tied to this experiment, which is governed by the snapshotSettings.metricSettings
  // after the introduction of metric slices
  // TODO(bryce): refactor the source of truth for metrics so that the expandedMetricMap isn't used to add
  // metrics to an experiment
  const selectedMetrics = getQueryableMetricsFromSnapshotSettings(
    snapshotSettings,
    metricMap,
  );
  if (!selectedMetrics.length) {
    throw new Error("Experiment must have at least 1 metric selected.");
  }

  const queries: Queries = [];

  const existingModel =
    await context.models.incrementalRefresh.getLockedBySnapshotId(
      experimentId,
      queryParentId,
    );
  const persistedUnitsTableFullName = existingModel?.unitsTableFullName ?? null;
  const unitsTableName = persistedUnitsTableFullName
    ? tableNameFromFullName(persistedUnitsTableFullName)
    : `${INCREMENTAL_UNITS_TABLE_PREFIX}_${experimentId}_${getRandomTableSuffix()}`;
  const unitsTableFullName =
    persistedUnitsTableFullName ??
    (integration.generateTablePath &&
      integration.generateTablePath(
        unitsTableName,
        settings.pipelineSettings?.writeDataset,
        settings.pipelineSettings?.writeDatabase,
        true,
      ));
  if (!unitsTableFullName) {
    throw new Error(
      "Unable to generate table; table path generator not specified.",
    );
  }

  const unitsTempTableFullName =
    integration.generateTablePath &&
    integration.generateTablePath(
      `${INCREMENTAL_UNITS_TABLE_PREFIX}_${experimentId}_temp_${getRandomTableSuffix()}`,
      settings.pipelineSettings?.writeDataset,
      settings.pipelineSettings?.writeDatabase,
      true,
    );
  if (!unitsTempTableFullName) {
    throw new Error(
      "Unable to generate table; table path generator not specified.",
    );
  }

  const incrementalRefreshModel = mode.kind === "full" ? null : existingModel;

  const executionId = params.queryParentId;

  // Dependencies can delay DDL until another snapshot takes over the lock.
  const fenced =
    <R>(
      run: (
        query: string,
        setExternalId: ExternalIdCallback,
        queryMetadata: RunQueryMetadata,
      ) => Promise<R>,
    ) =>
    async (
      query: string,
      setExternalId: ExternalIdCallback,
      queryMetadata: RunQueryMetadata,
    ): Promise<R> => {
      const lockHeld =
        await context.models.incrementalRefresh.isLockedBySnapshotId(
          experimentId,
          executionId,
        );
      if (!lockHeld) {
        throw new Error(
          "Incremental refresh lock was lost to another snapshot; aborting to avoid corrupting shared pipeline tables.",
        );
      }
      return run(query, setExternalId, queryMetadata);
    };

  const factMetrics: FactMetricInterface[] = [];
  for (const m of selectedMetrics) {
    if (!isFactMetric(m)) {
      throw new Error(
        "Only fact metrics are supported with incremental refresh.",
      );
    }
    factMetrics.push(m);
  }

  const desiredFanOut = planMetricFanOut(factMetrics);

  // Current per-metric settings hash for every selected fact metric, keyed by
  // metric id. Compared against the hash persisted in each metric source to
  // detect metrics whose configuration changed since their cache was built.
  const currentMetricSettingsHashes =
    getMetricSettingsHashesForIncrementalRefresh({
      factMetrics,
      factTableMap: params.factTableMap,
      snapshotSettings,
    });

  // Fact tables whose persisted cache no longer matches the desired metric
  // layout — a metric was added to or removed from the FT, a cross-FT ratio
  // side moved, or a metric's settings changed. Each of these reshapes the
  // cache, so we rebuild it end-to-end (CREATE + full INSERT) instead of
  // incrementally appending to an out-of-shape table. The per-FT loop below
  // sees no `existingSource` for these tables and rebuilds from scratch.
  // A new-metrics update instead rebuilds only the caches that take its
  // metrics (see getIncrementalRefreshMetricSources).
  // Experiment-level setting changes are handled upstream by
  // assertIncrementalRefreshPrerequisites (they force a full refresh).
  const factTablesToRebuild = getFactTablesNeedingRebuild({
    existingMetricSources: incrementalRefreshModel?.metricSources ?? [],
    desiredFanOut,
    currentMetricSettingsHashes,
    restateOnAddedMetric: !isNewMetricsUpdate,
  });

  // Begin Queries
  const lastMaxTimestamp = incrementalRefreshModel?.unitsMaxTimestamp;

  const exposureQuery = (settings?.queries?.exposure || []).find(
    (q) => q.id === snapshotSettings.exposureQueryId,
  );

  if (!exposureQuery) {
    throw new Error("Exposure query not found");
  }

  const resolvedExposureQuery = resolveExposureQueryForAnalysis(
    exposureQuery,
    snapshotSettings.exposureQueryIdentifierType,
  );
  const exposureUserIdType = resolvedExposureQuery.identifierType;

  const unitsSettings = buildUnitsQuerySettingsFromSnapshot(
    snapshotSettings,
    resolvedExposureQuery,
  );

  const {
    eligibleDimensions,
    // Used for traffic analysis
    eligibleDimensionsWithSlices,
    // Used for pre-computing/post-stratification
    eligibleDimensionsWithSlicesUnderMaxCells,
  } = getExposureQueryEligibleDimensions({
    exposureQuery,
    incrementalRefreshModel,
    nVariations: params.variationNames.length,
  });

  const isClusterExperiment = getClusterSubUnit(snapshotSettings) !== null;
  const isolatedDimensionIds = new Set(
    getIsolatedDimensionIds(snapshotSettings),
  );
  const parentPrecomputedDimensions: ExperimentDimensionWithSpecifiedSlices[] =
    isClusterExperiment ? [] : eligibleDimensionsWithSlicesUnderMaxCells;
  // Only breakdowns that a corresponding analysis actually requests (those in
  // snapshotSettings.dimensions, surfaced via getIsolatedDimensionIds) get an
  // isolated query.
  const isolatedPrecomputedDimensions: ExperimentDimensionWithSpecifiedSlices[] =
    isClusterExperiment
      ? eligibleDimensionsWithSlicesUnderMaxCells.filter((d) =>
          isolatedDimensionIds.has(`${PRECOMPUTED_DIMENSION_PREFIX}${d.id}`),
        )
      : [];

  const unitQueryParams: UpdateExperimentIncrementalUnitsQueryParams = {
    unitsTableFullName: unitsTableFullName,
    unitsTempTableFullName: unitsTempTableFullName,
    settings: snapshotSettings,
    exposureQuery: resolvedExposureQuery,
    activationMetric: null, // TODO(incremental-refresh): activation metric
    dimensions: eligibleDimensions,
    segment: segmentObj,
    incrementalRefreshStartTime: params.incrementalRefreshStartTime,
    factTableMap: params.factTableMap,
    lastMaxTimestamp: lastMaxTimestamp || null,
    lastMaxTimestampRaw: incrementalRefreshModel?.unitsMaxTimestampRaw ?? null,
  };

  const afterUnits: Record<"update" | "alter" | "maxTimestamp", string[]> = {
    update: [],
    alter: [],
    maxTimestamp: [],
  };
  if (appendsToStoredTables) {
    let createUnitsTableQuery: QueryPointer | null = null;
    if (mode.kind === "full") {
      const dropOldUnitsTableQuery = await startQuery({
        name: `drop_${queryParentId}_old`,
        query: integration.getDropOldIncrementalUnitsQuery({
          unitsTableFullName: unitQueryParams.unitsTableFullName,
        }),
        dependencies: [],
        run: fenced((query, setExternalId, queryMetadata) =>
          integration.runDropTableQuery(query, setExternalId, queryMetadata),
        ),
        queryType: "experimentIncrementalRefreshDropUnitsTable",
      });
      queries.push(dropOldUnitsTableQuery);

      createUnitsTableQuery = await startQuery({
        name: `create_${queryParentId}`,
        displayTitle: "Create Experiment Units Table",
        query:
          integration.getCreateExperimentIncrementalUnitsQuery(unitQueryParams),
        dependencies: [dropOldUnitsTableQuery.query],
        run: fenced((query, setExternalId, queryMetadata) =>
          integration.runIncrementalWithNoOutputQuery(
            query,
            setExternalId,
            queryMetadata,
          ),
        ),
        queryType: "experimentIncrementalRefreshCreateUnitsTable",
      });
      queries.push(createUnitsTableQuery);
    }

    const updateUnitsTableQuery = await startQuery({
      name: `update_${queryParentId}`,
      displayTitle: "Update Experiment Units Table",
      query:
        integration.getUpdateExperimentIncrementalUnitsQuery(unitQueryParams),
      dependencies: [
        ...(createUnitsTableQuery ? [createUnitsTableQuery.query] : []),
      ],
      run: (query, setExternalId, queryMetadata) =>
        integration.runIncrementalWithNoOutputQuery(
          query,
          setExternalId,
          queryMetadata,
        ),
      queryType: "experimentIncrementalRefreshUpdateUnitsTable",
    });
    queries.push(updateUnitsTableQuery);

    const dropUnitsTableQuery = await startQuery({
      name: `drop_${queryParentId}`,
      displayTitle: "Drop Old Experiment Units Table",
      query: integration.getDropOldIncrementalUnitsQuery({
        unitsTableFullName: unitsTableFullName,
      }),
      run: fenced((query, setExternalId, queryMetadata) =>
        integration.runDropTableQuery(query, setExternalId, queryMetadata),
      ),
      dependencies: [updateUnitsTableQuery.query],
      queryType: "experimentIncrementalRefreshDropUnitsTable",
    });
    queries.push(dropUnitsTableQuery);

    const alterUnitsTableQuery = await startQuery({
      name: `alter_${queryParentId}`,
      displayTitle: "Rename Experiment Units Table",
      query: integration.getAlterNewIncrementalUnitsQuery({
        unitsTableName: unitsTableName,
        unitsTableFullName: unitsTableFullName,
        unitsTempTableFullName: unitsTempTableFullName,
      }),
      dependencies: [dropUnitsTableQuery.query],
      run: fenced((query, setExternalId, queryMetadata) =>
        integration.runIncrementalWithNoOutputQuery(
          query,
          setExternalId,
          queryMetadata,
        ),
      ),
      queryType: "experimentIncrementalRefreshAlterUnitsTable",
    });
    queries.push(alterUnitsTableQuery);

    const maxTimestampUnitsTableQuery = await startQuery({
      name: `max_timestamp_${queryParentId}`,
      displayTitle: "Find Latest Experiment Source Timestamp",
      query: integration.getMaxTimestampIncrementalUnitsQuery({
        unitsTableFullName,
        lastMaxTimestamp: lastMaxTimestamp || null,
      }),
      dependencies: [alterUnitsTableQuery.query],
      run: (query, setExternalId, queryMetadata) =>
        integration.runIncrementalWithNoOutputQuery(
          query,
          setExternalId,
          queryMetadata,
        ),
      onSuccess: async (rows) => {
        // MAX() is NULL on an empty units table; persist null so a prior
        // watermark cannot survive a full refresh that matched no one.
        const watermark = parseMaxTimestampRow(rows[0]);

        const lockHeld =
          await context.models.incrementalRefresh.updateByExperimentIdIfCurrentExecution(
            experimentId,
            executionId,
            {
              unitsTableFullName: unitsTableFullName,
              unitsMaxTimestamp: watermark.maxTimestamp,
              unitsMaxTimestampRaw: watermark.maxTimestampRaw,
              experimentSettingsHash:
                getExperimentSettingsHashForIncrementalRefresh(
                  snapshotSettings,
                  integration.datasource.settings.queries?.exposure ?? [],
                ),
              unitsDimensions: eligibleDimensions.map((d) => d.id),
            },
          );
        if (lockHeld !== true) {
          context.logger.warn(
            "Incremental refresh execution lock lost for experiment: " +
              experimentId,
          );
        }
      },
      queryType: "experimentIncrementalRefreshMaxTimestampUnitsTable",
    });
    queries.push(maxTimestampUnitsTableQuery);
    afterUnits.update = [updateUnitsTableQuery.query];
    afterUnits.alter = [alterUnitsTableQuery.query];
    afterUnits.maxTimestamp = [maxTimestampUnitsTableQuery.query];
  }

  // Metric Queries

  // Full refresh will have a null incremental refresh model
  // Will recreate sources with new random id for metric sources
  const storedSources = incrementalRefreshModel?.metricSources ?? [];
  const storedCovariateSources =
    incrementalRefreshModel?.metricCovariateSources ?? [];

  // Caches of FTs flagged for rebuild above (added / removed metric, moved
  // cross-FT side, or changed metric settings) are replaced: the per-FT loop
  // below sees no `existingSource` and rebuilds them from scratch (CREATE +
  // full INSERT) instead of appending, since their schema/values may be out of
  // shape with the desired metric set. So is a source that takes new metrics,
  // under a new id. Their covariate caches are replaced with them so CUPED
  // state stays consistent. The replaced tables stay in the warehouse.
  const metricSourceGroups = getIncrementalRefreshMetricSources({
    metrics: factMetrics,
    existingMetricSources: storedSources.filter(
      (source) => !factTablesToRebuild.has(source.factTableId),
    ),
    extendExistingSources: isNewMetricsUpdate,
    integration,
    snapshotSettings,
  });
  const extendedGroupIds = new Set(
    metricSourceGroups.flatMap((g) =>
      g.replacesGroupId ? [g.replacesGroupId] : [],
    ),
  );
  const replacedGroupIds = new Set(
    storedSources
      .filter(
        (source) =>
          factTablesToRebuild.has(source.factTableId) ||
          extendedGroupIds.has(source.groupId),
      )
      .map((source) => source.groupId),
  );
  const existingSources = storedSources.filter(
    (source) => !replacedGroupIds.has(source.groupId),
  );
  const existingCovariateSources = storedCovariateSources.filter(
    (source) => !replacedGroupIds.has(source.groupId),
  );
  // A new-metrics update copies the parent's queries of every source it
  // keeps, by name, so a kept source must hold the metrics it held then.
  if (isNewMetricsUpdate) {
    for (const group of metricSourceGroups) {
      const stored = existingSources.find((s) => s.groupId === group.groupId);
      if (
        stored &&
        !isEqual(
          group.metrics.map((m) => m.id).sort(),
          stored.metrics.map((m) => m.id).sort(),
        )
      ) {
        throw new Error(
          `Metrics source ${group.groupId} would change its metrics without a new id`,
        );
      }
    }
  }
  let runningSourceData = existingSources;
  let runningCovariateSourceData = existingCovariateSources;

  // Track per-group state we need from the per-FT pass for the cross-FT
  // pair pass below: each pipeline's cache table name (so the stats query
  // can build its `metricSources` array) and the insert query, when this run
  // writes the cache (so the stats query can declare it as a dependency).
  interface SourcePipeline {
    group: MetricSourceGroups;
    tableFullName: string;
    insertQuery?: QueryPointer;
    // Optional covariate cache + insert query for this group, populated
    // only when at least one metric in the group is regression-adjusted.
    // The cross-FT pair pass below pairs both pipelines' covariate caches
    // into the `metricSources` entries it passes to the stats query.
    covariateTableFullName?: string;
    covariateInsertQuery?: QueryPointer;
  }
  const pipelineByGroupId = new Map<string, SourcePipeline>();

  for (const group of metricSourceGroups) {
    const existingSource = existingSources?.find(
      (s) => s.groupId === group.groupId,
    );

    const existingCovariateSource = existingCovariateSources?.find(
      (s) => s.groupId === group.groupId,
    );

    const metricSourceTableFullName: string | undefined =
      existingSource?.tableFullName ??
      (integration.generateTablePath &&
        integration.generateTablePath(
          `${INCREMENTAL_METRICS_TABLE_PREFIX}_${experimentId}_${group.groupId}`,
          settings.pipelineSettings?.writeDataset,
          settings.pipelineSettings?.writeDatabase,
          true,
        ));

    if (!metricSourceTableFullName) {
      throw new Error(
        "Unable to generate table; table path generator not specified.",
      );
    }

    const factTable = params.factTableMap.get(group.factTableId);

    // TODO(incremental-refresh): add metadata about source
    // in case same fact table is split across multiple sources
    const sourceName = factTable ? `(${factTable.name})` : "";

    // Same-FT analysis only runs over metrics whose data is fully present in
    // this cache — both numerator and denominator column refs point at this
    // FT. Cross-FT ratio metrics and multifact funnels have data spread
    // across caches; their stats are computed in dedicated passes below.
    const sameFtMetrics = group.metrics.filter((m) => {
      const ftIds = getFactMetricFactTableIds(m);
      return ftIds.length === 1 && ftIds[0] === group.factTableId;
    });

    let createMetricsSourceQuery: QueryPointer | null = null;
    if (!existingSource) {
      createMetricsSourceQuery = await startQuery({
        name: `create_metrics_source_${group.groupId}`,
        displayTitle: `Create Metrics Source ${sourceName}`,
        query: integration.getCreateMetricSourceTableQuery({
          settings: snapshotSettings,
          exposureQuery: resolvedExposureQuery,
          factTableId: group.factTableId,
          metrics: group.metrics,
          factTableMap: params.factTableMap,
          metricSourceTableFullName,
        }),
        dependencies: [...afterUnits.update],
        run: fenced((query, setExternalId, queryMetadata) =>
          integration.runIncrementalWithNoOutputQuery(
            query,
            setExternalId,
            queryMetadata,
          ),
        ),
        metadata: { factTableIds: [group.factTableId] },
        queryType: "experimentIncrementalRefreshCreateMetricsSourceTable",
      });
      queries.push(createMetricsSourceQuery);
    }

    let insertMetricsSourceDataQuery: QueryPointer | null = null;
    if (!existingSource || appendsToStoredTables) {
      const insertParams: InsertMetricSourceDataQueryParams = {
        settings: snapshotSettings,
        exposureQuery: resolvedExposureQuery,
        activationMetric: activationMetric,
        factTableMap: params.factTableMap,
        factTableId: group.factTableId,
        metricSourceTableFullName,
        unitsSourceTableFullName: unitsTableFullName,
        metrics: group.metrics,
        lastMaxTimestamp: existingSource?.maxTimestamp || null,
        lastMaxTimestampRaw: existingSource?.maxTimestampRaw ?? null,
        incrementalRefreshStartTime: params.incrementalRefreshStartTime,
      };

      insertMetricsSourceDataQuery = await startQuery({
        name: `insert_metrics_source_data_${group.groupId}`,
        displayTitle: `Update Metrics Source ${sourceName}`,
        query: integration.getInsertMetricSourceDataQuery(insertParams),
        dependencies: [
          ...(createMetricsSourceQuery ? [createMetricsSourceQuery.query] : []),
          ...afterUnits.alter,
        ],
        run: (query, setExternalId, queryMetadata) =>
          integration.runIncrementalWithNoOutputQuery(
            query,
            setExternalId,
            queryMetadata,
          ),
        metadata: { factTableIds: [group.factTableId] },
        queryType: "experimentIncrementalRefreshInsertMetricsSourceData",
      });
      queries.push(insertMetricsSourceDataQuery);
    }

    // CUPED tables — one covariate cache per group, holding only the
    // side(s) this FT actually materializes for each metric. Same-FT
    // metrics contribute both sides; cross-FT ratio metrics contribute
    // only their numerator side in their numerator FT's cache and only
    // their denominator side in their denominator FT's cache. The
    // schema/projection inside getInsertMetricSourceCovariateDataQuery
    // gates each side on `metric.numerator.factTableId === factTableId`
    // (and likewise for denominator) — we filter the input to only the
    // RA-eligible subset below so non-RA metrics don't bloat the schema.
    const metricSourceCovariateTableFullName: string | undefined =
      existingCovariateSource?.tableFullName ??
      (integration.generateTablePath &&
        integration.generateTablePath(
          `${INCREMENTAL_METRICS_TABLE_PREFIX}_${experimentId}_${group.groupId}_covariate`,
          settings.pipelineSettings?.writeDataset,
          settings.pipelineSettings?.writeDatabase,
          true,
        ));
    if (!metricSourceCovariateTableFullName) {
      throw new Error(
        "Unable to generate table; table path generator not specified.",
      );
    }
    // Only RA-eligible metrics drive the covariate cache; the stats query's
    // covariate join is gated on `isRegressionAdjusted`, so non-RA metrics need
    // nothing here.
    const regressionAdjustedMetrics = filterRegressionAdjustedMetrics(
      group.metrics,
      snapshotSettings,
    );
    const anyMetricHasCuped = regressionAdjustedMetrics.length > 0;
    let createMetricCovariateTableQuery: QueryPointer | null = null;
    let insertMetricCovariateDataQuery: QueryPointer | null = null;
    if (
      anyMetricHasCuped &&
      (!existingCovariateSource || appendsToStoredTables)
    ) {
      if (!existingCovariateSource) {
        // Safety net in case our data model is out of sync with the database
        const dropMetricCovariateTableQuery = await startQuery({
          name: `drop_metrics_covariate_table_${group.groupId}`,
          displayTitle: `Drop Old Metric Covariate Table ${sourceName}`,
          query: integration.getDropMetricSourceCovariateTableQuery({
            metricSourceCovariateTableFullName,
          }),
          dependencies: [...afterUnits.update],
          run: fenced((query, setExternalId, queryMetadata) =>
            integration.runDropTableQuery(query, setExternalId, queryMetadata),
          ),
          metadata: { factTableIds: [group.factTableId] },
          queryType: "experimentIncrementalRefreshDropMetricsCovariateTable",
        });
        queries.push(dropMetricCovariateTableQuery);

        createMetricCovariateTableQuery = await startQuery({
          name: `create_metrics_covariate_table_${group.groupId}`,
          displayTitle: `Create Metric Covariate Table ${sourceName}`,
          query: integration.getCreateMetricSourceCovariateTableQuery({
            settings: snapshotSettings,
            exposureQuery: resolvedExposureQuery,
            factTableId: group.factTableId,
            metrics: regressionAdjustedMetrics,
            metricSourceCovariateTableFullName,
          }),
          dependencies: [dropMetricCovariateTableQuery.query],
          run: fenced((query, setExternalId, queryMetadata) =>
            integration.runIncrementalWithNoOutputQuery(
              query,
              setExternalId,
              queryMetadata,
            ),
          ),
          metadata: { factTableIds: [group.factTableId] },
          queryType: "experimentIncrementalRefreshCreateMetricsCovariateTable",
        });
        queries.push(createMetricCovariateTableQuery);
      }

      // Pre-aggregated read when the whole group validates, else legacy scan.
      const { baseIdType: covariateGrainIdType } = resolveClusterMetricGrain({
        settings: snapshotSettings,
        metrics: group.metrics,
        exposureIdentifierType: exposureUserIdType,
      });

      const covariatePath = await resolveCovariateInsertPath({
        context,
        factTable,
        datasourceId: integration.datasource.id,
        exposureUserIdType: covariateGrainIdType,
        regressionAdjustedMetrics,
        settings: snapshotSettings,
        activationMetric,
      });

      experimentUpdateExecutionLogger?.recordCovariateSource({
        groupId: group.groupId,
        factTableId: group.factTableId ?? null,
        path: covariatePath.path,
        aggregatedTableFullName:
          covariatePath.path === "aggregated"
            ? covariatePath.aggregatedTableFullName
            : null,
        reason: covariatePath.reason,
      });

      const covariateInsertBaseParams = {
        name: `insert_metrics_covariate_data_${group.groupId}`,
        displayTitle: `Update Metric Covariate Data ${sourceName}`,
        dependencies: [
          ...afterUnits.maxTimestamp,
          ...(createMetricCovariateTableQuery
            ? [createMetricCovariateTableQuery.query]
            : []),
        ],
        run: (
          query: string,
          setExternalId: ExternalIdCallback,
          queryMetadata: RunQueryMetadata,
        ) =>
          integration.runIncrementalWithNoOutputQuery(
            query,
            setExternalId,
            queryMetadata,
          ),
        onSuccess: async () => {
          const incrementalRefresh =
            await context.models.incrementalRefresh.getLockedBySnapshotId(
              experimentId,
              queryParentId,
            );
          const lastSuccessfulMaxTimestamp =
            incrementalRefresh?.unitsMaxTimestamp ?? null;
          const lastSuccessfulMaxTimestampRaw =
            incrementalRefresh?.unitsMaxTimestampRaw ?? null;
          const updatedCovariateSource: IncrementalRefreshMetricCovariateSourceInterface =
            existingCovariateSource
              ? {
                  ...existingCovariateSource,
                  lastSuccessfulMaxTimestamp,
                  lastSuccessfulMaxTimestampRaw,
                }
              : {
                  groupId: group.groupId,
                  lastSuccessfulMaxTimestamp,
                  lastSuccessfulMaxTimestampRaw,
                  tableFullName: metricSourceCovariateTableFullName,
                };
          if (!existingCovariateSource) {
            runningCovariateSourceData = runningCovariateSourceData.concat(
              updatedCovariateSource,
            );
          } else {
            runningCovariateSourceData = runningCovariateSourceData.map((s) =>
              s.groupId === group.groupId ? updatedCovariateSource : s,
            );
          }
          const lockHeld =
            await context.models.incrementalRefresh.updateByExperimentIdIfCurrentExecution(
              experimentId,
              executionId,
              {
                metricCovariateSources: runningCovariateSourceData,
              },
            );
          if (lockHeld !== true) {
            context.logger.warn(
              "Incremental refresh execution lock lost for experiment: " +
                experimentId,
            );
          }
        },
      };

      const commonCovariateQueryParams = {
        settings: snapshotSettings,
        exposureQuery: resolvedExposureQuery,
        activationMetric: activationMetric,
        factTableMap: params.factTableMap,
        factTableId: group.factTableId,
        metricSourceCovariateTableFullName,
        unitsSourceTableFullName: unitsTableFullName,
        metrics: regressionAdjustedMetrics,
        lastCovariateSuccessfulMaxTimestamp:
          existingCovariateSource?.lastSuccessfulMaxTimestamp || null,
        lastCovariateSuccessfulMaxTimestampRaw:
          existingCovariateSource?.lastSuccessfulMaxTimestampRaw ?? null,
      };

      if (covariatePath.path === "aggregated") {
        insertMetricCovariateDataQuery = await startQuery({
          ...covariateInsertBaseParams,
          query:
            integration.getInsertMetricSourceCovariateFromAggregatedFactTableQuery(
              {
                ...commonCovariateQueryParams,
                aggregatedTableFullName: covariatePath.aggregatedTableFullName,
                idType: covariatePath.idType,
              },
            ),
          metadata: { factTableIds: [group.factTableId] },
          queryType:
            "experimentIncrementalRefreshInsertMetricsCovariateDataFromAggregated",
        });
      } else {
        insertMetricCovariateDataQuery = await startQuery({
          ...covariateInsertBaseParams,
          query: integration.getInsertMetricSourceCovariateDataQuery({
            ...commonCovariateQueryParams,
            // Align to daily grain whenever the grain id type is materialized,
            // so the fallback window always matches the pre-aggregated path.
            alignLegacyScanToDailyGrain: (
              factTable?.aggregatedFactTableSettings?.idTypes ?? []
            ).includes(covariateGrainIdType),
          }),
          metadata: { factTableIds: [group.factTableId] },
          queryType: "experimentIncrementalRefreshInsertMetricsCovariateData",
        });
      }
      queries.push(insertMetricCovariateDataQuery);
    }

    if (insertMetricsSourceDataQuery) {
      const maxTimestampMetricsSourceQuery = await startQuery({
        name: `max_timestamp_metrics_source_${group.groupId}`,
        displayTitle: `Find Latest Metrics Source Timestamp ${sourceName}`,
        query: integration.getMaxTimestampMetricSourceQuery({
          metricSourceTableFullName,
          lastMaxTimestamp: existingSource?.maxTimestamp || null,
        }),
        dependencies: [insertMetricsSourceDataQuery.query],
        run: (query, setExternalId, queryMetadata) =>
          integration.runMaxTimestampQuery(query, setExternalId, queryMetadata),
        onFailure: async () => {
          // Remove the source from the running data if max timestamp fails
          runningSourceData = runningSourceData.filter(
            (s) => s.groupId !== group.groupId,
          );
          // Note: onFailure is not awaited by QueryRunner, so we must catch
          // errors here to avoid unhandled promise rejections.
          context.models.incrementalRefresh
            .updateByExperimentIdIfCurrentExecution(experimentId, executionId, {
              metricSources: runningSourceData,
            })
            .catch((e) =>
              context.logger.error(
                e,
                "Failed to update metric sources on query failure",
              ),
            );
        },
        onSuccess: async (rows) => {
          // MAX() is NULL on an empty cache; persist null rather than skip
          // the source so the table isn't rebuilt on the next refresh.
          const { maxTimestamp, maxTimestampRaw } = parseMaxTimestampRow(
            rows[0],
          );
          // TODO(incremental-refresh): Clean up metadata handling in query runner
          const updatedSource: IncrementalRefreshMetricSourceInterface =
            existingSource
              ? { ...existingSource, maxTimestamp, maxTimestampRaw }
              : {
                  groupId: group.groupId,
                  factTableId: group.factTableId,
                  maxTimestamp,
                  maxTimestampRaw,
                  // (factTableId, metricId) is the persisted key. Which side
                  // of the metric this cache materializes is derived at read
                  // time by comparing the metric's column refs to
                  // `factTableId` (see metric-source-table-schema.ts).
                  metrics: group.metrics.map((m) => ({
                    id: m.id,
                    settingsHash: getMetricSettingsHashForIncrementalRefresh({
                      factMetric: m,
                      factTableMap: params.factTableMap,
                      metricSettings: snapshotSettings.metricSettings.find(
                        (ms) => ms.id === m.id,
                      ),
                      clusterMetricLevel: getClusterMetricCacheLevel(
                        snapshotSettings,
                        m.id,
                      ),
                    }),
                  })),
                  tableFullName: metricSourceTableFullName,
                };
          if (!existingSource) {
            runningSourceData = runningSourceData.concat(updatedSource);
          } else {
            runningSourceData = runningSourceData.map((s) =>
              s.groupId === group.groupId ? updatedSource : s,
            );
          }
          const lockHeld =
            await context.models.incrementalRefresh.updateByExperimentIdIfCurrentExecution(
              experimentId,
              executionId,
              {
                metricSources: runningSourceData,
              },
            );
          if (lockHeld !== true) {
            context.logger.warn(
              "Incremental refresh execution lock lost for experiment: " +
                experimentId,
            );
          }
        },
        metadata: { factTableIds: [group.factTableId] },
        queryType: "experimentIncrementalRefreshMaxTimestampMetricsSource",
      });
      queries.push(maxTimestampMetricsSourceQuery);
    }

    const writeQueryIds = [
      insertMetricsSourceDataQuery,
      insertMetricCovariateDataQuery,
    ].flatMap((q) => (q ? [q.query] : []));
    pipelineByGroupId.set(group.groupId, {
      group,
      tableFullName: metricSourceTableFullName,
      insertQuery: insertMetricsSourceDataQuery ?? undefined,
      covariateTableFullName: anyMetricHasCuped
        ? metricSourceCovariateTableFullName
        : undefined,
      covariateInsertQuery: insertMetricCovariateDataQuery ?? undefined,
    });

    // Schedule a same-FT statistics query for every metric in this group
    // whose numerator and denominator both live in this FT. Caches that
    // only host one half of a cross-FT ratio skip this — those metrics'
    // stats are computed in the cross-FT pair pass below.
    // skipPartialData: one stats query per conversion window over the shared table.
    if (sameFtMetrics.length > 0) {
      const partitions = partitionMetricsByConversionWindow(
        sameFtMetrics,
        snapshotSettings.skipPartialData,
        activationMetric,
      );
      for (const partition of partitions) {
        // Quantiles only run overall stats. Recheck per partition so a mixed
        // quantile/mean group only disables breakdowns on the quantile slice.
        const runOverallQuantileAnalysis =
          partition.metrics.some(quantileMetricType);

        const metricSources = [
          {
            factTableId: group.factTableId,
            tableFullName: metricSourceTableFullName,
            ...(anyMetricHasCuped && metricSourceCovariateTableFullName
              ? {
                  covariateTableFullName: metricSourceCovariateTableFullName,
                }
              : {}),
          },
        ];
        const baseStatisticsName = `${STATISTICS_QUERY_PREFIX}${group.groupId}${conversionWindowQueryNameSuffix(partition.window?.key)}`;

        for (const variant of getStatisticsQueryVariants({
          baseName: baseStatisticsName,
          breakdownsDisabled: runOverallQuantileAnalysis,
          parentFanOutDisabled: !!org.settings?.disablePrecomputedDimensions,
          parentPrecomputedDimensions,
          isolatedPrecomputedDimensions,
        })) {
          const statisticsQuery = await startQuery({
            name: variant.name,
            displayTitle: `Compute Statistics ${sourceName}`,
            query: integration.getIncrementalRefreshStatisticsQuery({
              settings: snapshotSettings,
              exposureQuery: resolvedExposureQuery,
              activationMetric: activationMetric,
              factTableMap: params.factTableMap,
              unitsSourceTableFullName: unitsTableFullName,
              metrics: partition.metrics,
              lastMaxTimestamp: existingSource?.maxTimestamp || null,
              asOf: params.incrementalRefreshStartTime,
              dimensionsForPrecomputation: variant.dimensionsForPrecomputation,
              dimensionsForAnalysis: [],
              metricSources,
            }),
            dependencies: writeQueryIds,
            run: (query, setExternalId, queryMetadata) =>
              integration.runIncrementalRefreshStatisticsQuery(
                query,
                setExternalId,
                queryMetadata,
              ),
            metadata: { factTableIds: [group.factTableId] },
            queryType: "experimentIncrementalRefreshStatistics",
          });
          queries.push(statisticsQuery);
        }
      }
    }
  }

  // Multi-source pass: for metrics that need 2+ fact table caches joined
  // (cross-FT ratios, multi-FT funnels, or both), schedule one stats query per
  // set of cache tables. Metrics over the same FT set share a joined query
  // only when they resolve to the same cache table for every FT; a fact table
  // chunked into several caches yields one query per chunk combination in use.
  const multiSourceSubGroups = buildMultiSourceSubGroups<SourcePipeline>({
    multiSourceGroups: desiredFanOut.multiSourceGroups,
    metricSourceGroups,
    pipelineByGroupId,
    onMissingPipeline: "throw",
    getWindowKey: (m) =>
      snapshotSettings.skipPartialData
        ? conversionWindowMinutesKey(
            getOverriddenMetricConversionWindowHours(
              m,
              activationMetric,
              snapshotSettings,
            ),
          )
        : null,
  });

  for (const subGroup of multiSourceSubGroups) {
    const ftNames = subGroup.pipelines
      .map(
        (p) =>
          params.factTableMap.get(p.group.factTableId)?.name ??
          p.group.factTableId,
      )
      .join(" x ");
    const sourceName = `(${ftNames})`;
    const queryNameParts = subGroup.pipelines
      .map((p) => p.group.groupId)
      .join("__");

    const baseStatisticsName = `${STATISTICS_QUERY_PREFIX}multi_${queryNameParts}${conversionWindowQueryNameSuffix(subGroup.windowKey)}`;
    const metricSources = subGroup.pipelines.map((p) => ({
      factTableId: p.group.factTableId,
      tableFullName: p.tableFullName,
      ...(p.covariateTableFullName
        ? { covariateTableFullName: p.covariateTableFullName }
        : {}),
    }));
    const statisticsDependencies = [
      ...subGroup.pipelines.flatMap((p) =>
        p.insertQuery ? [p.insertQuery.query] : [],
      ),
      ...subGroup.pipelines.flatMap((p) =>
        p.covariateInsertQuery ? [p.covariateInsertQuery.query] : [],
      ),
    ];

    for (const variant of getStatisticsQueryVariants({
      baseName: baseStatisticsName,
      // Multi-source stats never run the quantile overall-only path.
      breakdownsDisabled: false,
      parentFanOutDisabled: !!org.settings?.disablePrecomputedDimensions,
      parentPrecomputedDimensions,
      isolatedPrecomputedDimensions,
    })) {
      const multiSourceStatsQuery = await startQuery({
        name: variant.name,
        displayTitle: `Compute Multi-Source Statistics ${sourceName}`,
        query: integration.getIncrementalRefreshStatisticsQuery({
          settings: snapshotSettings,
          exposureQuery: resolvedExposureQuery,
          activationMetric: activationMetric,
          factTableMap: params.factTableMap,
          unitsSourceTableFullName: unitsTableFullName,
          metrics: subGroup.metrics,
          lastMaxTimestamp: null,
          asOf: params.incrementalRefreshStartTime,
          dimensionsForPrecomputation: variant.dimensionsForPrecomputation,
          dimensionsForAnalysis: [],
          metricSources,
        }),
        dependencies: statisticsDependencies,
        run: (query, setExternalId, queryMetadata) =>
          integration.runIncrementalRefreshStatisticsQuery(
            query,
            setExternalId,
            queryMetadata,
          ),
        metadata: {
          factTableIds: subGroup.pipelines.map((p) => p.group.factTableId),
        },
        queryType: "experimentIncrementalRefreshStatistics",
      });
      queries.push(multiSourceStatsQuery);
    }
  }

  const runTrafficQuery = shouldRunHealthTrafficQuery({
    snapshotType: params.snapshotType,
    snapshotDimensions: snapshotSettings.dimensions,
    runHealthTrafficQuery: org.settings?.runHealthTrafficQuery,
  });

  if (runTrafficQuery) {
    const trafficQuery = await startQuery({
      name: TRAFFIC_QUERY_NAME,
      query: integration.getExperimentAggregateUnitsQuery({
        ...unitQueryParams,
        unitsSettings,
        dimensions: eligibleDimensionsWithSlices,
        useUnitsTable: true,
      }),
      dependencies: [...afterUnits.alter],
      run: (query, setExternalId, queryMetadata) =>
        integration.runExperimentAggregateUnitsQuery(
          query,
          setExternalId,
          queryMetadata,
        ),
      queryType: "experimentTraffic",
    });
    queries.push(trafficQuery);

    if (snapshotSettings.isClusterExperiment) {
      const clusterTrafficQuery = await startQuery({
        name: CLUSTER_TRAFFIC_QUERY_NAME,
        query: integration.getExperimentAggregateUnitsQuery({
          ...unitQueryParams,
          unitsSettings,
          dimensions: eligibleDimensionsWithSlices,
          useUnitsTable: true,
          clusterGrain: true,
        }),
        dependencies: [...afterUnits.alter],
        run: (query, setExternalId, queryMetadata) =>
          integration.runExperimentAggregateUnitsQuery(
            query,
            setExternalId,
            queryMetadata,
          ),
        queryType: "experimentTraffic",
      });
      queries.push(clusterTrafficQuery);

      const clusterHealthQuery = await startQuery({
        name: CLUSTER_HEALTH_QUERY_NAME,
        query: integration.getExperimentClusterHealthQuery({
          ...unitQueryParams,
          unitsSettings,
          dimensions: eligibleDimensionsWithSlices,
          useUnitsTable: true,
        }),
        dependencies: [...afterUnits.alter],
        run: (query, setExternalId, queryMetadata) =>
          integration.runExperimentClusterHealthQuery(
            query,
            setExternalId,
            queryMetadata,
          ),
        queryType: "experimentTraffic",
      });
      queries.push(clusterHealthQuery);
    }
  }

  return queries;
};

export class ExperimentIncrementalRefreshQueryRunner extends QueryRunner<
  ExperimentSnapshotInterface,
  ExperimentIncrementalRefreshQueryParams,
  SnapshotResult
> {
  private variationNames: string[] = [];
  private metricMap: Map<string, ExperimentMetricInterface> = new Map();

  checkPermissions(): boolean {
    return this.context.permissions.canRunExperimentQueries(
      this.integration.datasource,
    );
  }

  protected override onHeartbeat(): void {
    this.context.models.incrementalRefresh
      .touchLockHeartbeat(this.model.experiment, this.model.id)
      .catch((e) =>
        this.context.logger.warn(
          e,
          "Failed to refresh incremental refresh lock heartbeat",
        ),
      );
  }

  prepareAnalysisData(
    params: Pick<
      ExperimentIncrementalRefreshQueryParams,
      "metricMap" | "variationNames"
    >,
  ): void {
    this.metricMap = params.metricMap;
    this.variationNames = params.variationNames;
  }

  async startQueries(
    params: ExperimentIncrementalRefreshQueryParams,
  ): Promise<Queries> {
    this.prepareAnalysisData(params);
    if (params.experimentQueryMetadata) {
      this.integration.setAdditionalQueryMetadata?.(
        params.experimentQueryMetadata,
      );
    }

    const incrementalRefreshModel =
      params.mode.kind === "full"
        ? null
        : await this.context.models.incrementalRefresh.getLockedBySnapshotId(
            params.experimentId,
            this.model.id,
          );

    const experiment = await getExperimentById(
      this.context,
      params.experimentId,
    );
    if (!experiment) {
      throw new Error("Experiment not found");
    }

    // Throws if any settings/experiment is not supported
    await assertIncrementalRefreshPrerequisites({
      org: this.context.org,
      integration: this.integration,
      snapshotSettings: params.snapshotSettings,
      metricMap: params.metricMap,
      experiment,
      incrementalRefreshModel,
      analysisType:
        params.mode.kind === "full" ? "main-fullRefresh" : "main-update",
    });

    if (this.experimentUpdateExecutionLogger) {
      this.experimentUpdateExecutionLogger.execution.incrementalRefreshMode =
        params.mode.kind === "full" ? "full" : "incremental";
      // Empty array distinguishes an incremental run with no RA covariate
      // groups from a non-incremental run (which leaves this null).
      this.experimentUpdateExecutionLogger.execution.covariateSources = [];
    }

    const newMetricsUpdate = getNewMetricsUpdate(this.model);
    const startQuery = this.startQuery.bind(this);
    return startExperimentIncrementalRefreshQueries(
      this.context,
      { ...params, isNewMetricsUpdate: !!newMetricsUpdate },
      this.integration,
      newMetricsUpdate
        ? await getNewMetricsUpdateStartQuery(
            this.context,
            this.model,
            newMetricsUpdate,
            startQuery,
          )
        : startQuery,
      this.experimentUpdateExecutionLogger,
    );
  }

  protected override getOverallQueryStatus(): QueryStatus {
    return getNewMetricsUpdateQueryStatus(
      this.model,
      super.getOverallQueryStatus(),
    );
  }

  // largely copied from ExperimentResultsQueryRunner
  async runAnalysis(queryMap: QueryMap): Promise<SnapshotResult> {
    const result: SnapshotResult = await analyzeSnapshotResults({
      context: this.context,
      snapshot: this.model,
      queryMap,
      metricMap: this.metricMap,
      variationNames: this.variationNames,
    });

    const healthSummary = summarizeHealth({
      trafficQuery: queryMap.get(TRAFFIC_QUERY_NAME),
      clusterTrafficQuery: queryMap.get(CLUSTER_TRAFFIC_QUERY_NAME),
      clusterHealthQuery: queryMap.get(CLUSTER_HEALTH_QUERY_NAME),
      settings: this.model.settings,
      analyses: result.analyses,
      experimentMaxLengthDays:
        this.context.org.settings?.experimentMaxLengthDays,
    });
    if (healthSummary) {
      result.health = healthSummary.health;
      result.multipleExposures =
        healthSummary.multipleExposures ?? result.multipleExposures;
    }

    return result;
  }

  async getLatestModel(): Promise<ExperimentSnapshotInterface> {
    const obj = await findSnapshotById(this.context, this.model.id);
    if (!obj)
      throw new Error("Could not load snapshot model: " + this.model.id);
    return obj;
  }

  /** True once another finalizer (reaper, cancel) has concluded this snapshot. */
  protected override isModelTerminal(
    model: ExperimentSnapshotInterface,
  ): boolean {
    return model.status !== "running";
  }

  /**
   * Persist error only while still running; release the incremental refresh
   * lock if the write wins.
   */
  protected override async writeErrorIfStillActive(
    error: string,
  ): Promise<void> {
    // Reached from the runner's own failure paths, where neither the queries
    // nor the analysis is known to be at fault.
    const wrote = await errorSnapshotIfStillRunning(
      this.context,
      this.model.id,
      { queries: this.model.queries, error },
      "unknown",
      { concludedBy: this.concludedBy },
      this.experimentUpdateExecutionLogger,
    );
    if (wrote) {
      await this.context.models.incrementalRefresh
        .releaseLock(this.model.experiment, this.model.id)
        .catch((e) =>
          this.context.logger.warn(
            e,
            "Failed to release incremental refresh lock on shutdown error",
          ),
        );
    }
  }

  async updateModel({
    status,
    queries,
    runStarted,
    result,
    error,
    failureCause,
  }: {
    status: QueryStatus;
    queries: Queries;
    runStarted?: Date;
    result?: SnapshotResult;
    error?: string;
    failureCause?: QueryRunnerFailureCause;
  }): Promise<ExperimentSnapshotInterface> {
    const snapshotStatus =
      status === "running"
        ? "running"
        : status === "failed"
          ? "error"
          : "success";

    const updates: Partial<ExperimentSnapshotInterface> = {
      queries,
      runStarted,
      error,
      ...result,
      status: snapshotStatus,
    };
    await updateSnapshot({
      context: this.context,
      id: this.model.id,
      updates,
      failureCause,
      conclusion: { concludedBy: this.concludedBy },
      experimentUpdateExecutionLogger: this.experimentUpdateExecutionLogger,
    });
    if (
      this.model.report &&
      ["failed", "partially-succeeded", "succeeded"].includes(status)
    ) {
      await updateReport(this.model.organization, this.model.report, {
        snapshot: this.model.id,
      });
    }

    // Release the incremental refresh lock on any terminal status
    // TODO: Properly handle partially-succeeded status that also becomes terminal??
    if (snapshotStatus !== "running") {
      if (snapshotStatus === "success") {
        await this.context.models.incrementalRefresh
          .updateByExperimentIdIfCurrentExecution(
            this.model.experiment,
            this.model.id,
            { materializedBySnapshotId: this.model.id },
          )
          .catch((e) =>
            this.context.logger.warn(
              e,
              "Failed to record pipeline tables snapshot id on success",
            ),
          );
      }

      await this.context.models.incrementalRefresh
        .releaseLock(this.model.experiment, this.model.id)
        .catch((e) =>
          this.context.logger.warn(
            e,
            "Failed to release incremental refresh lock on terminal status",
          ),
        );
    }

    return {
      ...this.model,
      ...updates,
    };
  }
}
