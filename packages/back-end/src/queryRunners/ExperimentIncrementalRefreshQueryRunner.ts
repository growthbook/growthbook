import { tabulateCovariateImbalance } from "shared/health";
import {
  ExperimentMetricInterface,
  isFactMetric,
  isRatioMetric,
  isRegressionAdjusted,
  quantileMetricType,
} from "shared/experiments";
import cloneDeep from "lodash/cloneDeep";
import { SegmentInterface } from "shared/types/segment";
import {
  IncrementalRefreshInterface,
  IncrementalRefreshMetricCovariateSourceInterface,
  IncrementalRefreshMetricSourceInterface,
} from "shared/validators";
import {
  ExperimentAggregateUnitsQueryResponseRows,
  ExternalIdCallback,
  InsertMetricSourceDataQueryParams,
  UpdateExperimentIncrementalUnitsQueryParams,
} from "shared/types/integrations";
import {
  ExperimentSnapshotInterface,
  ExperimentSnapshotSettings,
  SnapshotType,
} from "shared/types/experiment-snapshot";
import { buildUnitsQuerySettingsFromSnapshot } from "shared/util";
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
  findSnapshotById,
  updateSnapshot,
} from "back-end/src/models/ExperimentSnapshotModel";
import { SourceIntegrationInterface } from "back-end/src/types/Integration";
import { FactTableMap } from "back-end/src/models/FactTableModel";
import { updateReport } from "back-end/src/models/ReportModel";
import {
  analyzeExperimentResults,
  analyzeExperimentTraffic,
} from "back-end/src/services/stats";
import {
  getExperimentSettingsHashForIncrementalRefresh,
  getMetricSettingsHashForIncrementalRefresh,
  getFactTablesNeedingRebuild,
  assertIncrementalRefreshPrerequisites,
} from "back-end/src/enterprise/services/data-pipeline";
import { getExposureQueryEligibleDimensions } from "back-end/src/services/dimensions";
import { chunkMetrics } from "back-end/src/services/experimentQueries/experimentQueries";
import {
  filterRegressionAdjustedMetrics,
  planMetricFanOut,
} from "back-end/src/services/experimentQueries/planMetricFanOut";
import { buildCrossFtSubGroups } from "back-end/src/services/experimentQueries/crossFtSubGroups";
import { resolveCovariateInsertPath } from "back-end/src/integrations/sql/fact-metrics/resolve-covariate-insert-path";
import { ExperimentUpdateExecutionLogger } from "back-end/src/services/experimentUpdateExecutionLogger";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { applyMetricOverrides } from "back-end/src/util/integration";
import {
  SnapshotResult,
  TRAFFIC_QUERY_NAME,
} from "./ExperimentResultsQueryRunner";
import {
  QueryRunner,
  QueryMap,
  ProcessedRowsType,
  RowsType,
  StartQueryParams,
} from "./QueryRunner";
import { shouldRunHealthTrafficQuery } from "./snapshotQueryHelpers";

export const INCREMENTAL_UNITS_TABLE_PREFIX = "gb_units";
export const INCREMENTAL_METRICS_TABLE_PREFIX = "gb_metrics";
export const INCREMENTAL_CUPED_TABLE_PREFIX = "gb_cuped";

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
  fullRefresh: boolean;
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
}

export function getIncrementalRefreshMetricSources({
  metrics,
  existingMetricSources,
  integration,
  snapshotSettings,
}: {
  metrics: FactMetricInterface[];
  existingMetricSources: IncrementalRefreshInterface["metricSources"];
  integration: SourceIntegrationInterface;
  snapshotSettings: ExperimentSnapshotSettings;
}): MetricSourceGroups[] {
  // Authoritative fan-out (planMetricFanOut is the single source of truth
  // for which fact tables host which metrics). The grouping below only
  // decides how those metrics get chunked into one or more cache tables per
  // fact table.
  const fanOut = planMetricFanOut(metrics);

  // Each metric's group key — quantiles get their own cache, mirroring the
  // experimentQueries grouping rule.
  const getMetricGroupKey = (
    factTableId: string,
    metric: FactMetricInterface,
  ) => `${factTableId}${quantileMetricType(metric) ? "_qtile" : ""}`;

  // Metrics that map to a pre-existing cache table — keyed by that source's
  // groupId. Matching is done by (factTableId, metric id): a cross-FT ratio
  // metric appears in two groups (one per FT), and each FT's existing source
  // only collides on its own side.
  const existingBuckets = new Map<
    string,
    { factTableId: string; metrics: FactMetricInterface[] }
  >();

  // Metrics that need a new cache table — keyed by the canonical group key
  // (factTableId [+ "_qtile"]) so all compatible metrics land in one chunk list.
  const newBuckets = new Map<
    string,
    { factTableId: string; metrics: FactMetricInterface[] }
  >();

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

      const key = getMetricGroupKey(factTableId, metric);
      const bucket = newBuckets.get(key) ?? { factTableId, metrics: [] };
      bucket.metrics.push(metric);
      newBuckets.set(key, bucket);
    });
  });

  const finalGroups: MetricSourceGroups[] = [];

  existingBuckets.forEach((bucket, groupId) => {
    finalGroups.push({
      groupId,
      factTableId: bucket.factTableId,
      metrics: bucket.metrics,
    });
  });

  const sourceProps = integration.getSourceProperties();
  newBuckets.forEach((bucket, baseGroupId) => {
    const chunks = chunkMetrics({
      metrics: bucket.metrics.map((m) => {
        const metric = cloneDeep(m);
        // TODO(overrides): refactor overrides to beginning of analysis
        applyMetricOverrides(metric, snapshotSettings);
        return {
          metric,
          regressionAdjusted:
            isRegressionAdjusted(metric) &&
            snapshotSettings.regressionAdjustmentEnabled,
        };
      }),
      maxColumnsPerQuery: sourceProps.maxColumns,
      isBandit: !!snapshotSettings.banditSettings,
      efficientQuantileGrid: !!sourceProps.hasArrayQuantileGrid,
    });
    chunks.forEach((chunk, i) => {
      const randomId = Math.random().toString(36).substring(2, 15);
      finalGroups.push({
        groupId: `${baseGroupId}_${randomId}${i}`,
        factTableId: bucket.factTableId,
        metrics: chunk,
      });
    });
  });

  return finalGroups;
}

const startExperimentIncrementalRefreshQueries = async (
  context: ApiReqContext,
  params: ExperimentIncrementalRefreshQueryParams,
  integration: SourceIntegrationInterface,
  startQuery: (
    params: StartQueryParams<RowsType, ProcessedRowsType>,
  ) => Promise<QueryPointer>,
  experimentUpdateExecutionLogger: ExperimentUpdateExecutionLogger | null,
): Promise<Queries> => {
  const snapshotSettings = params.snapshotSettings;
  const queryParentId = params.queryParentId;
  const experimentId = params.experimentId;
  const metricMap = params.metricMap;

  const { org } = context;

  const activationMetric = snapshotSettings.activationMetric
    ? (metricMap.get(snapshotSettings.activationMetric) ?? null)
    : null;

  let segmentObj: SegmentInterface | null = null;
  if (snapshotSettings.segment) {
    segmentObj = await context.models.segments.getById(
      snapshotSettings.segment,
    );
  }

  const settings = integration.datasource.settings;

  // Only include metrics tied to this experiment, which is goverend by the snapshotSettings.metricSettings
  // after the introduction of metric slices
  // TODO(bryce): refactor the source of truth for metrics so that the expandedMetricMap isn't used to add
  // metrics to an experiment
  const selectedMetrics = snapshotSettings.metricSettings
    .map((m) => metricMap.get(m.id))
    .filter((m) => m) as ExperimentMetricInterface[];
  if (!selectedMetrics.length) {
    throw new Error("Experiment must have at least 1 metric selected.");
  }

  const queries: Queries = [];

  const unitsTableName = `${INCREMENTAL_UNITS_TABLE_PREFIX}_${experimentId}`;
  const unitsTableFullName =
    integration.generateTablePath &&
    integration.generateTablePath(
      unitsTableName,
      settings.pipelineSettings?.writeDataset,
      settings.pipelineSettings?.writeDatabase,
      true,
    );
  if (!unitsTableFullName) {
    throw new Error(
      "Unable to generate table; table path generator not specified.",
    );
  }

  const randomId = Math.random().toString(36).substring(2, 10);
  const unitsTempTableFullName =
    integration.generateTablePath &&
    integration.generateTablePath(
      `${INCREMENTAL_UNITS_TABLE_PREFIX}_${experimentId}_temp_${randomId}`,
      settings.pipelineSettings?.writeDataset,
      settings.pipelineSettings?.writeDatabase,
      true,
    );
  if (!unitsTempTableFullName) {
    throw new Error(
      "Unable to generate table; table path generator not specified.",
    );
  }

  const incrementalRefreshModel = params.fullRefresh
    ? null
    : await context.models.incrementalRefresh.getByExperimentId(experimentId);

  const executionId = params.queryParentId;

  // Wraps a `run` callback with an execution-fence check so that DDL on the
  // shared per-experiment pipeline tables (units / metric-source / covariate)
  // is skipped if another snapshot has taken over the lock since this run
  // started. Data ops (INSERT/SELECT) are intentionally left unfenced — they
  // either fail loudly against a missing table or no-op their model write via
  // `updateByExperimentIdIfCurrentExecution`. Checked at
  // execute time (not enqueue time) because all queries are enqueued up-front
  // but executed sequentially via dependencies — the lock can be lost between
  // dependent queries. releaseLock() is fenced on snapshotId, so the eventual
  // release on this run's terminal status is a safe no-op once the lock is lost.
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
      const current =
        await context.models.incrementalRefresh.getCurrentExecutionSnapshotId(
          experimentId,
        );
      if (current !== executionId) {
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
  const currentMetricSettingsHashes = new Map<string, string>();
  factMetrics.forEach((m) => {
    currentMetricSettingsHashes.set(
      m.id,
      getMetricSettingsHashForIncrementalRefresh({
        factMetric: m,
        factTableMap: params.factTableMap,
        metricSettings: snapshotSettings.metricSettings.find(
          (ms) => ms.id === m.id,
        ),
      }),
    );
  });

  // Fact tables whose persisted cache no longer matches the desired metric
  // layout — a metric was added to or removed from the FT, a cross-FT ratio
  // side moved, or a metric's settings changed. Each of these reshapes the
  // cache, so we rebuild it end-to-end (CREATE + full INSERT) instead of
  // incrementally appending to an out-of-shape table. The per-FT loop below
  // sees no `existingSource` for these tables and rebuilds from scratch.
  // Experiment-level setting changes are handled upstream by
  // assertIncrementalRefreshPrerequisites (they force a full refresh).
  const factTablesToRebuild = getFactTablesNeedingRebuild({
    existingMetricSources: incrementalRefreshModel?.metricSources ?? [],
    desiredFanOut,
    currentMetricSettingsHashes,
  });

  // Begin Queries
  const lastMaxTimestamp = incrementalRefreshModel?.unitsMaxTimestamp;

  const exposureQuery = (settings?.queries?.exposure || []).find(
    (q) => q.id === snapshotSettings.exposureQueryId,
  );

  if (!exposureQuery) {
    throw new Error("Exposure query not found");
  }

  const resolvedExposureQuery = {
    query: exposureQuery.query,
    userIdType: exposureQuery.userIdType,
  };

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
  };

  let createUnitsTableQuery: QueryPointer | null = null;
  if (params.fullRefresh) {
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
      const maxTimestamp = new Date(rows[0].max_timestamp as string);

      if (maxTimestamp) {
        const lockHeld =
          await context.models.incrementalRefresh.updateByExperimentIdIfCurrentExecution(
            experimentId,
            executionId,
            {
              unitsTableFullName: unitsTableFullName,
              unitsMaxTimestamp: maxTimestamp,
              experimentSettingsHash:
                getExperimentSettingsHashForIncrementalRefresh(
                  snapshotSettings,
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
      }
    },
    queryType: "experimentIncrementalRefreshMaxTimestampUnitsTable",
  });
  queries.push(maxTimestampUnitsTableQuery);

  // Metric Queries

  // Full refresh will have a null incremental refresh model
  // Will recreate sources with new random id for metric sources
  let existingSources = incrementalRefreshModel?.metricSources ?? [];
  let existingCovariateSources =
    incrementalRefreshModel?.metricCovariateSources ?? [];

  // Drop existing source records for FTs flagged for rebuild above (added /
  // removed metric, moved cross-FT side, or changed metric settings). The
  // per-FT loop below will see no `existingSource` and rebuild the cache from
  // scratch (CREATE + full INSERT) instead of incrementally appending — the
  // cache's schema/values may be out of shape with the desired metric set. The
  // matching covariate sources are dropped at the same time so CUPED state
  // stays consistent.
  if (factTablesToRebuild.size > 0) {
    const sourcesGroupIdsToDelete = new Set<string>();
    existingSources.forEach((source) => {
      if (factTablesToRebuild.has(source.factTableId)) {
        sourcesGroupIdsToDelete.add(source.groupId);
      }
    });
    existingSources = existingSources.filter(
      (source) => !sourcesGroupIdsToDelete.has(source.groupId),
    );
    existingCovariateSources = existingCovariateSources.filter(
      (source) => !sourcesGroupIdsToDelete.has(source.groupId),
    );
  }

  const metricSourceGroups = getIncrementalRefreshMetricSources({
    metrics: factMetrics,
    existingMetricSources: existingSources ?? [],
    integration,
    snapshotSettings,
  });
  let runningSourceData = existingSources ?? [];
  let runningCovariateSourceData = existingCovariateSources ?? [];

  // Track per-group state we need from the per-FT pass for the cross-FT
  // pair pass below: each pipeline's cache table name (so the stats query
  // can build its `metricSources` array) and the insert query (so the
  // stats query can declare it as a dependency).
  interface SourcePipeline {
    group: MetricSourceGroups;
    tableFullName: string;
    insertQuery: QueryPointer;
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
    // FT. Cross-FT ratio metrics have one side in this cache and one side in
    // another cache; their stats are computed in the cross-FT pair pass
    // below, so running them here would either double-count or read
    // half-populated columns.
    const sameFtMetrics = group.metrics.filter(
      (m) =>
        m.numerator.factTableId === group.factTableId &&
        (!isRatioMetric(m) || m.denominator?.factTableId === group.factTableId),
    );

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
        dependencies: [updateUnitsTableQuery.query],
        run: fenced((query, setExternalId, queryMetadata) =>
          integration.runIncrementalWithNoOutputQuery(
            query,
            setExternalId,
            queryMetadata,
          ),
        ),
        queryType: "experimentIncrementalRefreshCreateMetricsSourceTable",
      });
      queries.push(createMetricsSourceQuery);
    }

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
    };

    const insertMetricsSourceDataQuery = await startQuery({
      name: `insert_metrics_source_data_${group.groupId}`,
      displayTitle: `Update Metrics Source ${sourceName}`,
      query: integration.getInsertMetricSourceDataQuery(insertParams),
      dependencies: [
        ...(createMetricsSourceQuery ? [createMetricsSourceQuery.query] : []),
        alterUnitsTableQuery.query,
      ],
      run: (query, setExternalId, queryMetadata) =>
        integration.runIncrementalWithNoOutputQuery(
          query,
          setExternalId,
          queryMetadata,
        ),
      queryType: "experimentIncrementalRefreshInsertMetricsSourceData",
    });
    queries.push(insertMetricsSourceDataQuery);

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
          `${INCREMENTAL_METRICS_TABLE_PREFIX}_${group.groupId}_covariate`,
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
    if (anyMetricHasCuped) {
      if (!existingCovariateSource) {
        // Safety net in case our data model is out of sync with the database
        const dropMetricCovariateTableQuery = await startQuery({
          name: `drop_metrics_covariate_table_${group.groupId}`,
          displayTitle: `Drop Old Metric Covariate Table ${sourceName}`,
          query: integration.getDropMetricSourceCovariateTableQuery({
            metricSourceCovariateTableFullName,
          }),
          dependencies: [updateUnitsTableQuery.query],
          run: fenced((query, setExternalId, queryMetadata) =>
            integration.runDropTableQuery(query, setExternalId, queryMetadata),
          ),
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
          queryType: "experimentIncrementalRefreshCreateMetricsCovariateTable",
        });
        queries.push(createMetricCovariateTableQuery);
      }

      // Pre-aggregated read when the whole group validates, else legacy scan.
      const covariatePath = await resolveCovariateInsertPath({
        context,
        factTable,
        datasourceId: integration.datasource.id,
        exposureUserIdType: exposureQuery.userIdType,
        regressionAdjustedMetrics,
        settings: snapshotSettings,
        activationMetric,
      });

      experimentUpdateExecutionLogger?.recordCovariateSource({
        groupId: group.groupId,
        factTableId: group.factTableId ?? null,
        path: covariatePath.path,
        aggregatedTableFullName:
          covariatePath.path === "legacy"
            ? null
            : covariatePath.aggregatedTableFullName,
        reason: covariatePath.reason,
        uncoveredMetricCount:
          covariatePath.path === "mixed"
            ? covariatePath.uncoveredMetricIds.length
            : undefined,
      });

      const covariateInsertBaseParams = {
        dependencies: [
          maxTimestampUnitsTableQuery.query,
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
      };

      // Advances lastSuccessfulMaxTimestamp; attached only to the LAST insert
      // in the chain so a partial mixed-path write can't skip units on retry.
      const covariateInsertOnSuccess = async () => {
        const incrementalRefresh =
          await context.models.incrementalRefresh.getByExperimentId(
            experimentId,
          );
        const lastSuccessfulMaxTimestamp =
          incrementalRefresh?.unitsMaxTimestamp ?? null;
        const updatedCovariateSource: IncrementalRefreshMetricCovariateSourceInterface =
          existingCovariateSource
            ? {
                ...existingCovariateSource,
                lastSuccessfulMaxTimestamp,
              }
            : {
                groupId: group.groupId,
                lastSuccessfulMaxTimestamp,
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
      };

      const commonCovariateQueryParams = {
        settings: snapshotSettings,
        exposureQuery: resolvedExposureQuery,
        activationMetric: activationMetric,
        factTableMap: params.factTableMap,
        factTableId: group.factTableId,
        metricSourceCovariateTableFullName,
        unitsSourceTableFullName: unitsTableFullName,
        lastCovariateSuccessfulMaxTimestamp:
          existingCovariateSource?.lastSuccessfulMaxTimestamp || null,
      };

      // Align to daily grain whenever the exposure id type is materialized,
      // so the legacy scan computes the same covariate window as the
      // pre-aggregated path.
      const alignLegacyScanToDailyGrain = (
        factTable?.aggregatedFactTableSettings?.idTypes ?? []
      ).includes(exposureQuery.userIdType);

      if (covariatePath.path === "aggregated") {
        insertMetricCovariateDataQuery = await startQuery({
          ...covariateInsertBaseParams,
          name: `insert_metrics_covariate_data_${group.groupId}`,
          displayTitle: `Update Metric Covariate Data ${sourceName}`,
          query:
            integration.getInsertMetricSourceCovariateFromAggregatedFactTableQuery(
              {
                ...commonCovariateQueryParams,
                metrics: regressionAdjustedMetrics,
                aggregatedTableFullName: covariatePath.aggregatedTableFullName,
                idType: covariatePath.idType,
              },
            ),
          onSuccess: covariateInsertOnSuccess,
          queryType:
            "experimentIncrementalRefreshInsertMetricsCovariateDataFromAggregated",
        });
        queries.push(insertMetricCovariateDataQuery);
      } else if (covariatePath.path === "mixed") {
        // Per-slice fallback: covered metric columns from the aggregated
        // table, uncovered ones (typically compound customMetricSlices) from
        // a legacy raw scan over only those metrics. Both INSERTs target the
        // same destination table; the downstream stats read collapses the two
        // rows per unit with `MAX(...) GROUP BY unit`, so the split is
        // transparent. The legacy residual depends on the aggregated insert
        // and is the only one to advance lastSuccessfulMaxTimestamp.
        const coveredSet = new Set(covariatePath.coveredMetricIds);
        const coveredMetrics = regressionAdjustedMetrics.filter((m) =>
          coveredSet.has(m.id),
        );
        const uncoveredMetrics = regressionAdjustedMetrics.filter(
          (m) => !coveredSet.has(m.id),
        );

        const aggregatedInsertQuery = await startQuery({
          ...covariateInsertBaseParams,
          name: `insert_metrics_covariate_data_${group.groupId}`,
          displayTitle: `Update Metric Covariate Data ${sourceName}`,
          query:
            integration.getInsertMetricSourceCovariateFromAggregatedFactTableQuery(
              {
                ...commonCovariateQueryParams,
                metrics: coveredMetrics,
                aggregatedTableFullName: covariatePath.aggregatedTableFullName,
                idType: covariatePath.idType,
              },
            ),
          queryType:
            "experimentIncrementalRefreshInsertMetricsCovariateDataFromAggregated",
        });
        queries.push(aggregatedInsertQuery);

        insertMetricCovariateDataQuery = await startQuery({
          ...covariateInsertBaseParams,
          name: `insert_metrics_covariate_data_legacy_residual_${group.groupId}`,
          displayTitle: `Update Metric Covariate Data (Uncovered Slices) ${sourceName}`,
          dependencies: [
            ...covariateInsertBaseParams.dependencies,
            aggregatedInsertQuery.query,
          ],
          query: integration.getInsertMetricSourceCovariateDataQuery({
            ...commonCovariateQueryParams,
            metrics: uncoveredMetrics,
            alignLegacyScanToDailyGrain,
          }),
          onSuccess: covariateInsertOnSuccess,
          queryType: "experimentIncrementalRefreshInsertMetricsCovariateData",
        });
        queries.push(insertMetricCovariateDataQuery);
      } else {
        insertMetricCovariateDataQuery = await startQuery({
          ...covariateInsertBaseParams,
          name: `insert_metrics_covariate_data_${group.groupId}`,
          displayTitle: `Update Metric Covariate Data ${sourceName}`,
          query: integration.getInsertMetricSourceCovariateDataQuery({
            ...commonCovariateQueryParams,
            metrics: regressionAdjustedMetrics,
            alignLegacyScanToDailyGrain,
          }),
          onSuccess: covariateInsertOnSuccess,
          queryType: "experimentIncrementalRefreshInsertMetricsCovariateData",
        });
        queries.push(insertMetricCovariateDataQuery);
      }
    }

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
        const maxTimestamp = new Date(rows[0].max_timestamp as string);
        if (maxTimestamp) {
          // TODO(incremental-refresh): Clean up metadata handling in query runner
          const updatedSource: IncrementalRefreshMetricSourceInterface =
            existingSource
              ? { ...existingSource, maxTimestamp }
              : {
                  groupId: group.groupId,
                  factTableId: group.factTableId,
                  maxTimestamp,
                  // (factTableId, metricId) is the persisted key. Which side
                  // of the metric this cache materializes is derived at read
                  // time by comparing the metric's column refs to
                  // `factTableId` (see metric-source-table-schema.ts).
                  metrics: group.metrics.map((m) => ({
                    id: m.id,
                    settingsHash: getMetricSettingsHashForIncrementalRefresh({
                      factMetric: m,
                      factTableMap: params.factTableMap,
                      metricSettings: insertParams.settings.metricSettings.find(
                        (ms) => ms.id === m.id,
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
        }
      },
      queryType: "experimentIncrementalRefreshMaxTimestampMetricsSource",
    });
    queries.push(maxTimestampMetricsSourceQuery);

    pipelineByGroupId.set(group.groupId, {
      group,
      tableFullName: metricSourceTableFullName,
      insertQuery: insertMetricsSourceDataQuery,
      covariateTableFullName: anyMetricHasCuped
        ? metricSourceCovariateTableFullName
        : undefined,
      covariateInsertQuery: insertMetricCovariateDataQuery ?? undefined,
    });

    // Schedule a same-FT statistics query for every metric in this group
    // whose numerator and denominator both live in this FT. Caches that
    // only host one half of a cross-FT ratio skip this — those metrics'
    // stats are computed in the cross-FT pair pass below.
    if (sameFtMetrics.length > 0) {
      // Match standard query runner behavior: quantiles only run overall
      // stats (no pre-computed dimensions), regardless of requested
      // dimensions.
      const runOverallQuantileAnalysis = sameFtMetrics.some(quantileMetricType);
      const dimensionsForPrecomputation =
        org.settings?.disablePrecomputedDimensions || runOverallQuantileAnalysis
          ? []
          : eligibleDimensionsWithSlicesUnderMaxCells;

      const statisticsQuery = await startQuery({
        name: `statistics_${group.groupId}`,
        displayTitle: `Compute Statistics ${sourceName}`,
        query: integration.getIncrementalRefreshStatisticsQuery({
          settings: snapshotSettings,
          exposureQuery: resolvedExposureQuery,
          activationMetric: activationMetric,
          factTableMap: params.factTableMap,
          unitsSourceTableFullName: unitsTableFullName,
          metrics: sameFtMetrics,
          lastMaxTimestamp: existingSource?.maxTimestamp || null,
          dimensionsForPrecomputation,
          dimensionsForAnalysis: [],
          metricSources: [
            {
              factTableId: group.factTableId,
              tableFullName: metricSourceTableFullName,
              ...(anyMetricHasCuped && metricSourceCovariateTableFullName
                ? { covariateTableFullName: metricSourceCovariateTableFullName }
                : {}),
            },
          ],
        }),
        dependencies: [
          insertMetricsSourceDataQuery.query,
          ...(insertMetricCovariateDataQuery
            ? [insertMetricCovariateDataQuery.query]
            : []),
        ],
        run: (query, setExternalId, queryMetadata) =>
          integration.runIncrementalRefreshStatisticsQuery(
            query,
            setExternalId,
            queryMetadata,
          ),
        queryType: "experimentIncrementalRefreshStatistics",
      });
      queries.push(statisticsQuery);
    }
  }

  // Cross-FT pair pass: for every unordered pair of fact tables that hosts
  // at least one cross-FT ratio metric, schedule a single joined stats
  // query. The query reads both caches and computes per-metric ratios using
  // each metric's correct orientation. Same-FT metrics that happen to share
  // a cache with these cross-FT halves are NOT included here — they ran in
  // the per-FT loop above.
  const crossFtSubGroups = buildCrossFtSubGroups<SourcePipeline>({
    crossFtPairs: desiredFanOut.crossFtPairs,
    metricSourceGroups,
    pipelineByGroupId,
    // Main runner: the per-FT pass above must have built every pipeline a
    // cross-FT metric needs. A missing pipeline indicates a fan-out bug.
    onMissingPipeline: "throw",
  });

  for (const subGroup of crossFtSubGroups) {
    const [pipelineA, pipelineB] = subGroup.pipelines;
    const ftA = params.factTableMap.get(pipelineA.group.factTableId);
    const ftB = params.factTableMap.get(pipelineB.group.factTableId);
    const sourceName = ftA && ftB ? `(${ftA.name} x ${ftB.name})` : "";

    // Quantile metrics cannot be cross-FT ratios, so this set is always
    // non-quantile and supports pre-computed dimensions.
    const dimensionsForPrecomputation = org.settings
      ?.disablePrecomputedDimensions
      ? []
      : eligibleDimensionsWithSlicesUnderMaxCells;

    const crossStatsQuery = await startQuery({
      name: `statistics_cross_${pipelineA.group.groupId}__${pipelineB.group.groupId}`,
      displayTitle: `Compute Cross-Fact Statistics ${sourceName}`,
      query: integration.getIncrementalRefreshStatisticsQuery({
        settings: snapshotSettings,
        exposureQuery: resolvedExposureQuery,
        activationMetric: activationMetric,
        factTableMap: params.factTableMap,
        unitsSourceTableFullName: unitsTableFullName,
        metrics: subGroup.metrics.map((m) => m.metric),
        // The earliest of the two caches' max timestamps gates which rows
        // we can trust as fully populated. For simplicity we just pass
        // null; the stats query reads whatever each cache holds and the
        // ratio aggregation works regardless of catch-up state.
        lastMaxTimestamp: null,
        dimensionsForPrecomputation,
        dimensionsForAnalysis: [],
        // Cross-FT CUPED uses one covariate cache per pipeline — the
        // numerator FT's cache carries `_value` covariates, the
        // denominator FT's cache carries `_denominator_value` covariates,
        // and the per-source covariate LEFT JOIN inside each
        // `__joinedData{i}` picks the right side from each side's cache.
        // Pipelines with no RA metrics omit `covariateTableFullName`.
        metricSources: [
          {
            factTableId: pipelineA.group.factTableId,
            tableFullName: pipelineA.tableFullName,
            ...(pipelineA.covariateTableFullName
              ? { covariateTableFullName: pipelineA.covariateTableFullName }
              : {}),
          },
          {
            factTableId: pipelineB.group.factTableId,
            tableFullName: pipelineB.tableFullName,
            ...(pipelineB.covariateTableFullName
              ? { covariateTableFullName: pipelineB.covariateTableFullName }
              : {}),
          },
        ],
      }),
      dependencies: [
        pipelineA.insertQuery.query,
        pipelineB.insertQuery.query,
        ...(pipelineA.covariateInsertQuery
          ? [pipelineA.covariateInsertQuery.query]
          : []),
        ...(pipelineB.covariateInsertQuery
          ? [pipelineB.covariateInsertQuery.query]
          : []),
      ],
      run: (query, setExternalId, queryMetadata) =>
        integration.runIncrementalRefreshStatisticsQuery(
          query,
          setExternalId,
          queryMetadata,
        ),
      queryType: "experimentIncrementalRefreshStatistics",
    });
    queries.push(crossStatsQuery);
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
      dependencies: [alterUnitsTableQuery.query],
      run: (query, setExternalId, queryMetadata) =>
        integration.runExperimentAggregateUnitsQuery(
          query,
          setExternalId,
          queryMetadata,
        ),
      queryType: "experimentTraffic",
    });
    queries.push(trafficQuery);
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

  async startQueries(
    params: ExperimentIncrementalRefreshQueryParams,
  ): Promise<Queries> {
    this.metricMap = params.metricMap;
    this.variationNames = params.variationNames;
    if (params.experimentQueryMetadata) {
      this.integration.setAdditionalQueryMetadata?.(
        params.experimentQueryMetadata,
      );
    }

    const incrementalRefreshModel = params.fullRefresh
      ? null
      : await this.context.models.incrementalRefresh.getByExperimentId(
          params.experimentId,
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
      analysisType: params.fullRefresh ? "main-fullRefresh" : "main-update",
    });

    if (this.experimentUpdateExecutionLogger) {
      this.experimentUpdateExecutionLogger.execution.incrementalRefreshMode =
        params.fullRefresh ? "full" : "incremental";
      // Empty array distinguishes an incremental run with no RA covariate
      // groups from a non-incremental run (which leaves this null).
      this.experimentUpdateExecutionLogger.execution.covariateSources = [];
    }

    return await startExperimentIncrementalRefreshQueries(
      this.context,
      params,
      this.integration,
      this.startQuery.bind(this),
      this.experimentUpdateExecutionLogger,
    );
  }

  // largely copied from ExperimentResultsQueryRunner
  async runAnalysis(queryMap: QueryMap): Promise<SnapshotResult> {
    const { results: analysesResults, banditResult } =
      await analyzeExperimentResults({
        queryData: queryMap,
        snapshotSettings: this.model.settings,
        analysisSettings: this.model.analyses.map((a) => a.settings),
        variationNames: this.variationNames,
        metricMap: this.metricMap,
      });

    const result: SnapshotResult = {
      analyses: this.model.analyses,
      multipleExposures: 0,
      unknownVariations: [],
      banditResult,
    };

    analysesResults.forEach((results, i) => {
      const analysis = this.model.analyses[i];
      if (!analysis) return;

      analysis.results = results.dimensions || [];
      analysis.status = "success";
      analysis.error = "";

      // TODO: do this once, not per analysis
      result.unknownVariations = results.unknownVariations || [];
      result.multipleExposures = results.multipleExposures ?? 0;
    });

    //Run health checks
    const healthQuery = queryMap.get(TRAFFIC_QUERY_NAME);
    if (healthQuery) {
      const rows =
        healthQuery.result as ExperimentAggregateUnitsQueryResponseRows;
      const trafficHealth = analyzeExperimentTraffic({
        rows: rows,
        error: healthQuery.error,
        variations: this.model.settings.variations,
      });

      result.health = {
        traffic: trafficHealth,
      };

      // TODO(incremental-refresh): ensure power calculations work
      // const _relativeAnalysis = this.model.analyses.find(
      //   (a) => a.settings.differenceType === "relative",
      // );

      // const isEligibleForMidExperimentPowerAnalysis =
      //   relativeAnalysis &&
      //   this.model.settings.banditSettings === undefined &&
      //   rows &&
      //   rows.length;

      // if (isEligibleForMidExperimentPowerAnalysis) {
      //   const today = new Date();
      //   const phaseStartDate = this.model.settings.startDate;
      //   const experimentMaxLengthDays =
      //     this.context.org.settings?.experimentMaxLengthDays;

      //   const experimentTargetEndDate = addDays(
      //     phaseStartDate,
      //     experimentMaxLengthDays && experimentMaxLengthDays > 0
      //       ? experimentMaxLengthDays
      //       : FALLBACK_EXPERIMENT_MAX_LENGTH_DAYS,
      //   );
      //   const targetDaysRemaining = daysBetween(today, experimentTargetEndDate);
      //   // NB: This does not run a SQL query, but it is a health check that depends on the trafficHealth
      //   result.health.power = analyzeExperimentPower({
      //     trafficHealth,
      //     targetDaysRemaining,
      //     analysis: relativeAnalysis,
      //     goalMetrics: this.model.settings.goalMetrics,
      //     variationsSettings: this.model.settings.variations,
      //   });
      // }
      const analysisForCovariateImbalance = this.model.analyses.find(
        (a) => a.settings.useCovariateAsResponse === true,
      );
      const isEligibleForCovariateImbalanceAnalysis =
        !!analysisForCovariateImbalance;
      if (isEligibleForCovariateImbalanceAnalysis) {
        result.health.covariateImbalance = tabulateCovariateImbalance(
          analysisForCovariateImbalance,
          this.model.settings.goalMetrics,
          this.model.settings.guardrailMetrics,
          this.model.settings.secondaryMetrics,
          this.model.settings.metricSettings,
        );
      }
    }

    return result;
  }

  async getLatestModel(): Promise<ExperimentSnapshotInterface> {
    const obj = await findSnapshotById(this.context, this.model.id);
    if (!obj)
      throw new Error("Could not load snapshot model: " + this.model.id);
    return obj;
  }

  async updateModel({
    status,
    queries,
    runStarted,
    result,
    error,
  }: {
    status: QueryStatus;
    queries: Queries;
    runStarted?: Date;
    result?: SnapshotResult;
    error?: string;
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
