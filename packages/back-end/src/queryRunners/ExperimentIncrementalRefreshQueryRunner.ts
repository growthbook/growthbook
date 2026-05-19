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
  InsertMetricSourceDataQueryParams,
  UpdateExperimentIncrementalUnitsQueryParams,
} from "shared/types/integrations";
import {
  ExperimentSnapshotInterface,
  ExperimentSnapshotSettings,
  SnapshotType,
} from "shared/types/experiment-snapshot";
import {
  ExperimentQueryMetadata,
  Queries,
  QueryPointer,
  QueryStatus,
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
} from "back-end/src/services/experimentTimeSeries";
import { validateIncrementalPipeline } from "back-end/src/services/dataPipeline";
import { getExposureQueryEligibleDimensions } from "back-end/src/services/dimensions";
import { chunkMetrics } from "back-end/src/services/experimentQueries/experimentQueries";
import {
  CrossFtRatioMetric,
  planMetricFanOut,
} from "back-end/src/services/experimentQueries/planMetricFanOut";
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

  // Buckets are either "use this existing source" (alreadyExists=true) or
  // "start a new chunkable bucket" (alreadyExists=false). Matching against
  // existing sources is done by (factTableId, metric id) — a cross-FT ratio
  // metric appears in two groups (one per FT), and each FT's existing
  // source only collides on its own side.
  const buckets: Record<
    string,
    {
      alreadyExists: boolean;
      factTableId: string;
      metrics: FactMetricInterface[];
    }
  > = {};

  fanOut.perFt.forEach(({ factTableId, metrics: ftMetrics }) => {
    ftMetrics.forEach((metric) => {
      const existingGroup = existingMetricSources.find(
        (s) =>
          s.factTableId === factTableId &&
          s.metrics.some((m) => m.id === metric.id),
      );

      if (existingGroup) {
        const bucketKey = `__existing__${existingGroup.groupId}`;
        buckets[bucketKey] = buckets[bucketKey] ?? {
          alreadyExists: true,
          factTableId,
          metrics: [],
        };
        buckets[bucketKey].metrics.push(metric);
        return;
      }

      const bucketKey = `__new__${getMetricGroupKey(factTableId, metric)}`;
      buckets[bucketKey] = buckets[bucketKey] ?? {
        alreadyExists: false,
        factTableId,
        metrics: [],
      };
      buckets[bucketKey].metrics.push(metric);
    });
  });

  const finalGroups: MetricSourceGroups[] = [];
  Object.entries(buckets).forEach(([bucketKey, bucket]) => {
    if (bucket.alreadyExists) {
      finalGroups.push({
        groupId: bucketKey.slice("__existing__".length),
        factTableId: bucket.factTableId,
        metrics: bucket.metrics,
      });
      return;
    }

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
      maxColumnsPerQuery: integration.getSourceProperties().maxColumns,
      isBandit: !!snapshotSettings.banditSettings,
    });
    const baseGroupId = bucketKey.slice("__new__".length);
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

  // When the desired layout adds new (factTableId, metricId, role) tuples to
  // a fact table — either a fresh metric, or an existing metric whose role
  // shifted (e.g. same-FT → cross-FT) — we need to rebuild that FT's cache
  // so the schema and data line up with the new role assignments.
  // Removed tuples are fine: we simply stop populating them.
  const factTablesWithNewMetrics = new Set<string>();

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

  if (incrementalRefreshModel && incrementalRefreshModel.metricSources.length) {
    // Bidirectional (factTableId, metricId) diff between stored caches and
    // the desired fan-out:
    //   - new (factTableId, metricId) tuples → the cache for that FT needs
    //     to grow → mark it for rebuild.
    //   - orphaned stored tuples (no counterpart in the desired fan-out)
    //     → that cache holds a metric or a side that no longer applies (e.g.
    //     a cross-FT ratio whose denominator was moved back into the
    //     numerator FT) → mark its FT for rebuild too.
    // Orientation flips (numerator FT swap, denominator FT swap) on a
    // single metric are caught even earlier by the settingsHash check in
    // dataPipeline.ts, but the orphan branch here is what handles the case
    // where the metric simply stops appearing in a previously-used FT.
    const storedTuples = new Set<string>();
    incrementalRefreshModel.metricSources.forEach((source) => {
      source.metrics.forEach((m) => {
        storedTuples.add(`${source.factTableId}|${m.id}`);
      });
    });
    const desiredTuples = new Set<string>();
    desiredFanOut.perFt.forEach(({ factTableId, metrics: ftMetrics }) => {
      ftMetrics.forEach((metric) => {
        const tuple = `${factTableId}|${metric.id}`;
        desiredTuples.add(tuple);
        if (!storedTuples.has(tuple)) {
          factTablesWithNewMetrics.add(factTableId);
        }
      });
    });
    incrementalRefreshModel.metricSources.forEach((source) => {
      source.metrics.forEach((m) => {
        if (!desiredTuples.has(`${source.factTableId}|${m.id}`)) {
          factTablesWithNewMetrics.add(source.factTableId);
        }
      });
    });
  }

  // Begin Queries
  const lastMaxTimestamp = incrementalRefreshModel?.unitsMaxTimestamp;

  const exposureQuery = (settings?.queries?.exposure || []).find(
    (q) => q.id === snapshotSettings.exposureQueryId,
  );

  if (!exposureQuery) {
    throw new Error("Exposure query not found");
  }

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
      run: (query, setExternalId, queryMetadata) =>
        integration.runDropTableQuery(query, setExternalId, queryMetadata),
      queryType: "experimentIncrementalRefreshDropUnitsTable",
    });
    queries.push(dropOldUnitsTableQuery);

    createUnitsTableQuery = await startQuery({
      name: `create_${queryParentId}`,
      displayTitle: "Create Experiment Units Table",
      query:
        integration.getCreateExperimentIncrementalUnitsQuery(unitQueryParams),
      dependencies: [dropOldUnitsTableQuery.query],
      run: (query, setExternalId, queryMetadata) =>
        integration.runIncrementalWithNoOutputQuery(
          query,
          setExternalId,
          queryMetadata,
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
    run: (query, setExternalId, queryMetadata) =>
      integration.runDropTableQuery(query, setExternalId, queryMetadata),
    dependencies: [updateUnitsTableQuery.query],
    queryType: "experimentIncrementalRefreshDropUnitsTable",
  });
  queries.push(dropUnitsTableQuery);

  const alterUnitsTableQuery = await startQuery({
    name: `alter_${queryParentId}`,
    displayTitle: "Rename Experiment Units Table",
    query: integration.getAlterNewIncrementalUnitsQuery({
      unitsTableName: unitsTableName,
      unitsTempTableFullName: unitsTempTableFullName,
    }),
    dependencies: [dropUnitsTableQuery.query],
    run: (query, setExternalId, queryMetadata) =>
      integration.runIncrementalWithNoOutputQuery(
        query,
        setExternalId,
        queryMetadata,
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

  // Filter out metric source groups that belong to fact tables whose
  // desired (metric id, role) set has changed since last run. Dropping
  // them here forces the per-FT loop below to re-create the cache with
  // the new schema instead of trying to incrementally update it (which
  // would leave the cache misaligned with the desired layout).
  if (factTablesWithNewMetrics.size > 0) {
    const sourcesGroupIdsToDelete = new Set<string>();
    existingSources.forEach((source) => {
      if (factTablesWithNewMetrics.has(source.factTableId)) {
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
  // pair pass below: the cache table identity (for `metricSources[]`) plus
  // the insert query (for downstream dependencies).
  interface SourcePipeline {
    group: MetricSourceGroups;
    tableFullName: string;
    insertQuery: QueryPointer;
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
          factTableId: group.factTableId,
          metrics: group.metrics,
          factTableMap: params.factTableMap,
          metricSourceTableFullName,
        }),
        dependencies: [updateUnitsTableQuery.query],
        run: (query, setExternalId, queryMetadata) =>
          integration.runIncrementalWithNoOutputQuery(
            query,
            setExternalId,
            queryMetadata,
          ),
        queryType: "experimentIncrementalRefreshCreateMetricsSourceTable",
      });
      queries.push(createMetricsSourceQuery);
    }

    const insertParams: InsertMetricSourceDataQueryParams = {
      settings: snapshotSettings,
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

    // CUPED tables — only same-FT (role "complete") metrics can carry
    // regression adjustment (cross-FT ratio CUPED is rejected upstream by
    // validateIncrementalPipeline), so we filter to those before deciding
    // whether to materialize a covariate cache.
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
    const anyMetricHasCuped = sameFtMetrics.some((m) => {
      const metric = cloneDeep(m);
      applyMetricOverrides(metric, snapshotSettings);
      return (
        snapshotSettings.regressionAdjustmentEnabled &&
        isRegressionAdjusted(metric)
      );
    });
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
          run: (query, setExternalId, queryMetadata) =>
            integration.runDropTableQuery(query, setExternalId, queryMetadata),
          queryType: "experimentIncrementalRefreshDropMetricsCovariateTable",
        });
        queries.push(dropMetricCovariateTableQuery);

        createMetricCovariateTableQuery = await startQuery({
          name: `create_metrics_covariate_table_${group.groupId}`,
          displayTitle: `Create Metric Covariate Table ${sourceName}`,
          query: integration.getCreateMetricSourceCovariateTableQuery({
            settings: snapshotSettings,
            metrics: sameFtMetrics,
            metricSourceCovariateTableFullName,
          }),
          dependencies: [dropMetricCovariateTableQuery.query],
          run: (query, setExternalId, queryMetadata) =>
            integration.runIncrementalWithNoOutputQuery(
              query,
              setExternalId,
              queryMetadata,
            ),
          queryType: "experimentIncrementalRefreshCreateMetricsCovariateTable",
        });
        queries.push(createMetricCovariateTableQuery);
      }

      insertMetricCovariateDataQuery = await startQuery({
        name: `insert_metrics_covariate_data_${group.groupId}`,
        displayTitle: `Update Metric Covariate Data ${sourceName}`,
        query: integration.getInsertMetricSourceCovariateDataQuery({
          settings: snapshotSettings,
          activationMetric: activationMetric,
          factTableMap: params.factTableMap,
          metricSourceCovariateTableFullName,
          unitsSourceTableFullName: unitsTableFullName,
          metrics: sameFtMetrics,
          lastCovariateSuccessfulMaxTimestamp:
            existingCovariateSource?.lastSuccessfulMaxTimestamp || null,
        }),
        dependencies: [
          maxTimestampUnitsTableQuery.query,
          ...(createMetricCovariateTableQuery
            ? [createMetricCovariateTableQuery.query]
            : []),
        ],
        run: (query, setExternalId, queryMetadata) =>
          integration.runIncrementalWithNoOutputQuery(
            query,
            setExternalId,
            queryMetadata,
          ),
        onSuccess: async () => {
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
        },
        queryType: "experimentIncrementalRefreshInsertMetricsCovariateData",
      });
      queries.push(insertMetricCovariateDataQuery);
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
    });

    // Schedule a same-FT statistics query for every "complete" entry in this
    // group. Caches that only host one half of a cross-FT ratio skip this —
    // their metrics' stats are computed in the cross-FT pair pass below.
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
          activationMetric: activationMetric,
          factTableMap: params.factTableMap,
          unitsSourceTableFullName: unitsTableFullName,
          metrics: sameFtMetrics,
          lastMaxTimestamp: existingSource?.maxTimestamp || null,
          dimensionsForPrecomputation,
          dimensionsForAnalysis: [],
          metricSourceTables: {
            [group.factTableId]: metricSourceTableFullName,
          },
          metricSourceCovariateTableFullName,
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
  for (const pair of desiredFanOut.crossFtPairs) {
    // Group cross-FT metrics by the unordered pair of cache pipelines
    // they need to be joined against. A/B and B/A end up in the same
    // subGroup — the SQL layer is symmetric on source order for cross-FT
    // queries (source-0 privileges only apply to CUPED + event quantile,
    // neither of which can be cross-FT), so we collapse both orientations
    // into a single joined stats query.
    const subGroups = new Map<
      string,
      {
        pipelines: [SourcePipeline, SourcePipeline];
        metrics: CrossFtRatioMetric[];
      }
    >();

    for (const crossFt of pair.metrics) {
      // The metric's numerator/denominator FT pins which cache holds which
      // side. Orientation is carried by the metric's own column refs, so we
      // just need to find both caches.
      const numeratorGroup = metricSourceGroups.find(
        (g) =>
          g.factTableId === crossFt.numeratorFactTableId &&
          g.metrics.some((m) => m.id === crossFt.metric.id),
      );
      const denominatorGroup = metricSourceGroups.find(
        (g) =>
          g.factTableId === crossFt.denominatorFactTableId &&
          g.metrics.some((m) => m.id === crossFt.metric.id),
      );
      if (!numeratorGroup || !denominatorGroup) {
        // planMetricFanOut should always produce both halves, so this is a
        // bug in grouping rather than a runtime condition we can recover
        // from.
        throw new Error(
          `Cross-FT ratio metric "${crossFt.metric.id}" is missing its numerator or denominator source group.`,
        );
      }
      const numPipeline = pipelineByGroupId.get(numeratorGroup.groupId);
      const denomPipeline = pipelineByGroupId.get(denominatorGroup.groupId);
      if (!numPipeline || !denomPipeline) {
        throw new Error(
          `Cross-FT ratio metric "${crossFt.metric.id}" is missing an insert pipeline.`,
        );
      }
      // Canonicalize so (numPipeline, denomPipeline) and the reverse-direction
      // metric (denomPipeline, numPipeline) hash to the same subGroup.
      const sortedPipelines: [SourcePipeline, SourcePipeline] =
        numPipeline.group.groupId < denomPipeline.group.groupId
          ? [numPipeline, denomPipeline]
          : [denomPipeline, numPipeline];
      const subGroupKey = `${sortedPipelines[0].group.groupId}__${sortedPipelines[1].group.groupId}`;
      const existing = subGroups.get(subGroupKey);
      if (existing) {
        existing.metrics.push(crossFt);
      } else {
        subGroups.set(subGroupKey, {
          pipelines: sortedPipelines,
          metrics: [crossFt],
        });
      }
    }

    for (const subGroup of subGroups.values()) {
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
          metricSourceTables: {
            [pipelineA.group.factTableId]: pipelineA.tableFullName,
            [pipelineB.group.factTableId]: pipelineB.tableFullName,
          },
          // Cross-FT CUPED is rejected by validateIncrementalPipeline, so
          // this query never reads a covariate cache.
          metricSourceCovariateTableFullName: null,
        }),
        dependencies: [
          // TODO CUPED
          pipelineA.insertQuery.query,
          pipelineB.insertQuery.query,
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
    await validateIncrementalPipeline({
      org: this.context.org,
      integration: this.integration,
      snapshotSettings: params.snapshotSettings,
      metricMap: params.metricMap,
      factTableMap: params.factTableMap,
      experiment,
      incrementalRefreshModel,
      analysisType: params.fullRefresh ? "main-fullRefresh" : "main-update",
    });

    return await startExperimentIncrementalRefreshQueries(
      this.context,
      params,
      this.integration,
      this.startQuery.bind(this),
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
