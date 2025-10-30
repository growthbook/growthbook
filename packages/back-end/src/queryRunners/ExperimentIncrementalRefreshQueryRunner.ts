import {
  ExperimentMetricInterface,
  isFactMetric,
  isRatioMetric,
  isRegressionAdjusted,
  quantileMetricType,
} from "shared/experiments";
import chunk from "lodash/chunk";
import cloneDeep from "lodash/cloneDeep";
import { orgHasPremiumFeature } from "back-end/src/enterprise";
import { ApiReqContext } from "back-end/types/api";
import {
  ExperimentSnapshotInterface,
  ExperimentSnapshotSettings,
  SnapshotType,
} from "back-end/types/experiment-snapshot";
import {
  ExperimentQueryMetadata,
  Queries,
  QueryPointer,
  QueryStatus,
} from "back-end/types/query";
import {
  findSnapshotById,
  updateSnapshot,
} from "back-end/src/models/ExperimentSnapshotModel";
import {
  ExperimentAggregateUnitsQueryResponseRows,
  ExperimentDimension,
  InsertMetricSourceDataQueryParams,
  SourceIntegrationInterface,
  UpdateExperimentIncrementalUnitsQueryParams,
} from "back-end/src/types/Integration";
import { FactTableMap } from "back-end/src/models/FactTableModel";
import { updateReport } from "back-end/src/models/ReportModel";
import { FactMetricInterface } from "back-end/types/fact-table";
import {
  IncrementalRefreshInterface,
  IncrementalRefreshMetricCovariateSourceInterface,
  IncrementalRefreshMetricSourceInterface,
} from "back-end/src/validators/incremental-refresh";
import {
  analyzeExperimentResults,
  analyzeExperimentTraffic,
} from "back-end/src/services/stats";
import {
  getExperimentSettingsHashForIncrementalRefresh,
  getMetricSettingsHashForIncrementalRefresh,
} from "back-end/src/services/experimentTimeSeries";
import { SegmentInterface } from "back-end/types/segment";
import { applyMetricOverrides } from "back-end/src/util/integration";
import {
  MAX_METRICS_PER_QUERY,
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

export const INCREMENTAL_UNITS_TABLE_PREFIX = "growthbook_units";
export const INCREMENTAL_METRICS_TABLE_PREFIX = "growthbook_metrics";
export const INCREMENTAL_CUPED_TABLE_PREFIX = "growthbook_cuped";

export type ExperimentIncrementalRefreshQueryParams = {
  snapshotType: SnapshotType;
  snapshotSettings: ExperimentSnapshotSettings;
  variationNames: string[];
  metricMap: Map<string, ExperimentMetricInterface>;
  factTableMap: FactTableMap;
  queryParentId: string;
  experimentQueryMetadata: ExperimentQueryMetadata | null;
  // Incremental Refresh specific
  fullRefresh: boolean;
  incrementalRefreshStartTime: Date;
};

// TODO(incremental-refresh): add metrics to existing metric source to force recreating the whole thing.
// UI side to let the user know a refresh will trigger restating the whole metric source.
export interface MetricSourceGroups {
  groupId: string;
  metrics: FactMetricInterface[];
}

function validateFactMetricForIncrementalRefresh(metric: FactMetricInterface) {
  if (
    isRatioMetric(metric) &&
    metric.numerator.factTableId !== metric.denominator?.factTableId
  ) {
    throw new Error(
      "Ratio metrics must have the same numerator and denominator fact table with incremental refresh.",
    );
  }

  if (quantileMetricType(metric)) {
    throw new Error(
      "Quantile metrics are not supported with incremental refresh.",
    );
  }
}

function getIncrementalRefreshMetricSources(
  metrics: FactMetricInterface[],
  existingMetricSources: IncrementalRefreshInterface["metricSources"],
): {
  metrics: FactMetricInterface[];
  groupId: string;
  factTableId: string;
}[] {
  // TODO(incremental-refresh): skip partial data is currently ignored
  // TODO(incremental-refresh): error if no efficient percentiles
  // shouldn't be possible since we are unlikely to build incremental
  // refresh for mySQL
  const groups: Record<
    string,
    {
      alreadyExists: boolean;
      factTableId: string;
      metrics: FactMetricInterface[];
    }
  > = {};

  metrics.forEach((metric) => {
    validateFactMetricForIncrementalRefresh(metric);

    const existingGroup = existingMetricSources.find((group) =>
      group.metrics.some((m) => m.id === metric.id),
    );

    if (existingGroup) {
      groups[existingGroup.groupId] = groups[existingGroup.groupId] || {
        alreadyExists: true,
        factTableId: existingGroup.factTableId,
        metrics: [],
      };
      groups[existingGroup.groupId].metrics.push(metric);
      return;
    }

    // TODO(incremental-refresh): handle cross-table metrics
    const factTableId = metric.numerator.factTableId;

    groups[factTableId] = groups[factTableId] || {
      alreadyExists: false,
      factTableId,
      metrics: [],
    };
    groups[factTableId].metrics.push(metric);
  });

  const finalGroups: {
    groupId: string;
    factTableId: string;
    metrics: FactMetricInterface[];
  }[] = [];
  Object.entries(groups).forEach(([groupId, group]) => {
    if (group.alreadyExists) {
      finalGroups.push({
        groupId,
        factTableId: group.factTableId,
        metrics: group.metrics,
      });
      return;
    }

    // if a new group, ensure chunks are small enough
    const chunks = chunk(group.metrics, MAX_METRICS_PER_QUERY);
    chunks.forEach((chunk, i) => {
      const randomId = Math.random().toString(36).substring(2, 15);
      finalGroups.push({
        groupId: groupId + "_" + randomId + i,
        factTableId: group.factTableId,
        metrics: chunk,
      });
    });
  });

  return finalGroups;
}

export const startExperimentIncrementalRefreshQueries = async (
  context: ApiReqContext,
  params: ExperimentIncrementalRefreshQueryParams,
  integration: SourceIntegrationInterface,
  startQuery: (
    params: StartQueryParams<RowsType, ProcessedRowsType>,
  ) => Promise<QueryPointer>,
): Promise<Queries> => {
  const snapshotSettings = params.snapshotSettings;
  const queryParentId = params.queryParentId;
  const metricMap = params.metricMap;

  const { org } = context;
  const hasIncrementalRefreshFeature = orgHasPremiumFeature(
    org,
    "incremental-refresh",
  );

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

  const canRunIncrementalRefreshQueries =
    hasIncrementalRefreshFeature &&
    settings.pipelineSettings?.mode === "incremental";

  const queries: Queries = [];

  if (!canRunIncrementalRefreshQueries) {
    throw new Error("Integration does not support incremental refresh queries");
  }

  const unitsTableName = `${INCREMENTAL_UNITS_TABLE_PREFIX}_${queryParentId}`;
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
      `${INCREMENTAL_UNITS_TABLE_PREFIX}_${queryParentId}_temp_${randomId}`,
      settings.pipelineSettings?.writeDataset,
      settings.pipelineSettings?.writeDatabase,
      true,
    );
  if (!unitsTempTableFullName) {
    throw new Error(
      "Unable to generate table; table path generator not specified.",
    );
  }

  const incrementalRefreshModel =
    await context.models.incrementalRefresh.getByExperimentId(
      // FIX-ME(incremental-refresh): This is the experimentId, and snapshotSettings.experimentId is the trackingKey
      params.queryParentId,
    );

  // When adding new metrics to a fact table, we will need to scan the whole table.
  // So to simplify things we re-create the whole metric source.
  // When removing metrics this is not needed, we just don't insert updated data.
  const factTablesWithNewMetrics = new Set<string>();

  // If not forcing a full refresh and we have a previous run, ensure the
  // current configuration matches what the incremental pipeline was built with.
  if (!params.fullRefresh && incrementalRefreshModel) {
    const currentSettingsHash =
      getExperimentSettingsHashForIncrementalRefresh(snapshotSettings);
    if (
      incrementalRefreshModel.experimentSettingsHash &&
      currentSettingsHash !== incrementalRefreshModel.experimentSettingsHash
    ) {
      throw new Error(
        "The experiment configuration is outdated. Please run a Full Refresh.",
      );
    }

    // Validate metric settings hashes for existing metric sources
    if (incrementalRefreshModel.metricSources?.length) {
      const existingMetricHashMap = new Map<string, string>();
      incrementalRefreshModel.metricSources.forEach((source) => {
        source.metrics.forEach((metric) => {
          existingMetricHashMap.set(metric.id, metric.settingsHash);
        });
      });

      const storedMetricIds = new Set<string>(
        Array.from(existingMetricHashMap.keys()),
      );
      const selectedFactMetrics = selectedMetrics.filter((m) =>
        isFactMetric(m),
      );
      const selectedFactMetricIds = new Set<string>(
        selectedFactMetrics.map((m) => m.id),
      );

      // New metrics that we don't have incremental data for
      const addedMetrics = new Set<FactMetricInterface>();
      for (const m of selectedFactMetrics) {
        if (!storedMetricIds.has(m.id)) {
          addedMetrics.add(m);
        }
      }

      const removedMetricIds = new Set<string>();
      for (const storedId of storedMetricIds) {
        if (!selectedFactMetricIds.has(storedId)) {
          removedMetricIds.add(storedId);
        }
      }

      // Ratio metrics must have the same numerator and denominator fact table for now
      addedMetrics.forEach((m) => {
        const factTableId = m.numerator?.factTableId;
        if (factTableId) {
          factTablesWithNewMetrics.add(factTableId);
        }
      });

      selectedMetrics
        .filter((m) => isFactMetric(m))
        .forEach((m) => {
          const storedHash = existingMetricHashMap.get(m.id);
          if (!storedHash) return;

          const currentHash = getMetricSettingsHashForIncrementalRefresh({
            factMetric: m,
            factTableMap: params.factTableMap,
            metricSettings: snapshotSettings.metricSettings.find(
              (ms) => ms.id === m.id,
            ),
          });

          if (currentHash !== storedHash) {
            const metricName = m.name ?? m.id;
            throw new Error(
              `The metric "${metricName}" configuration is outdated. Please run a Full Refresh.`,
            );
          }
        });
    }
  }

  // Begin Queries
  const lastMaxTimestamp = params.fullRefresh
    ? snapshotSettings.startDate
    : (incrementalRefreshModel?.unitsMaxTimestamp ??
      snapshotSettings.startDate);

  const exposureQuery = (settings?.queries?.exposure || []).find(
    (q) => q.id === snapshotSettings.exposureQueryId,
  );

  let experimentDimensions: ExperimentDimension[] = [];
  if (exposureQuery?.dimensionMetadata) {
    experimentDimensions = exposureQuery.dimensionMetadata
      .filter((dm) => exposureQuery.dimensions.includes(dm.dimension))
      .map((dm) => ({
        type: "experiment",
        id: dm.dimension,
        specifiedSlices: dm.specifiedSlices,
      }));
  }
  const unitQueryParams: UpdateExperimentIncrementalUnitsQueryParams = {
    unitsTableFullName: unitsTableFullName,
    unitsTempTableFullName: unitsTempTableFullName,
    settings: snapshotSettings,
    activationMetric: null, // TODO(incremental-refresh): activation metric
    dimensions: experimentDimensions, // TODO(incremental-refresh): validate experiment dimensions are available
    segment: segmentObj,
    incrementalRefreshStartTime: params.incrementalRefreshStartTime,
    factTableMap: params.factTableMap,
    lastMaxTimestamp: lastMaxTimestamp,
  };

  let createUnitsTableQuery: QueryPointer | null = null;
  if (params.fullRefresh) {
    const dropOldUnitsTableQuery = await startQuery({
      name: `drop_${queryParentId}_old`,
      query: integration.getDropOldIncrementalUnitsQuery({
        unitsTableFullName: unitQueryParams.unitsTableFullName,
      }),
      dependencies: [],
      run: (query, setExternalId) =>
        integration.runDropTableQuery(query, setExternalId),
      process: (rows) => rows,
      queryType: "experimentIncrementalRefreshDropUnitsTable",
    });
    queries.push(dropOldUnitsTableQuery);

    createUnitsTableQuery = await startQuery({
      name: `create_${queryParentId}`,
      displayTitle: "Create Experiment Units Table",
      query:
        integration.getCreateExperimentIncrementalUnitsQuery(unitQueryParams),
      dependencies: [dropOldUnitsTableQuery.query],
      run: (query, setExternalId) =>
        integration.runIncrementalWithNoOutputQuery(query, setExternalId),
      process: (rows) => rows,
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
    run: (query, setExternalId) =>
      integration.runIncrementalWithNoOutputQuery(query, setExternalId),
    process: (rows) => rows,
    queryType: "experimentIncrementalRefreshUpdateUnitsTable",
  });
  queries.push(updateUnitsTableQuery);

  const dropUnitsTableQuery = await startQuery({
    name: `drop_${queryParentId}`,
    displayTitle: "Drop Old Experiment Units Table",
    query: integration.getDropOldIncrementalUnitsQuery({
      unitsTableFullName: unitsTableFullName,
    }),
    run: (query, setExternalId) =>
      integration.runDropTableQuery(query, setExternalId),
    dependencies: [updateUnitsTableQuery.query],
    process: (rows) => rows,
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
    run: (query, setExternalId) =>
      integration.runIncrementalWithNoOutputQuery(query, setExternalId),
    process: (rows) => rows,
    queryType: "experimentIncrementalRefreshAlterUnitsTable",
  });
  queries.push(alterUnitsTableQuery);

  const unitsTablePartitionsName =
    integration.generateTablePath &&
    integration.generateTablePath(
      // TODO this needs to be dynamic
      // Trino/Presto: `"${INCREMENTAL_UNITS_TABLE_PREFIX}_${queryParentId}$partitions"`,
      `${INCREMENTAL_UNITS_TABLE_PREFIX}_${queryParentId}`,
      settings.pipelineSettings?.writeDataset,
      settings.pipelineSettings?.writeDatabase,
      true,
    );
  const maxTimestampQuery = await startQuery({
    name: `max_timestamp_${queryParentId}`,
    displayTitle: "Find Latest Experiment Source Timestamp",
    query: integration.getMaxTimestampIncrementalUnitsQuery({
      unitsTablePartitionsName: unitsTablePartitionsName ?? unitsTableFullName,
    }),
    dependencies: [alterUnitsTableQuery.query],
    run: (query, setExternalId) =>
      integration.runIncrementalWithNoOutputQuery(query, setExternalId),
    process: (rows) => {
      // TODO(incremental-refresh): Clean up metadata handling in query runner
      const maxTimestamp = new Date(rows[0].max_timestamp as string);

      if (maxTimestamp) {
        context.models.incrementalRefresh
          .upsertByExperimentId(params.queryParentId, {
            unitsTableFullName: unitsTableFullName,
            unitsMaxTimestamp: maxTimestamp,
            experimentSettingsHash:
              getExperimentSettingsHashForIncrementalRefresh(snapshotSettings),
          })
          .catch((e) => context.logger.error(e));
      }
      return rows;
    },
    queryType: "experimentIncrementalRefreshMaxTimestampUnitsTable",
  });
  queries.push(maxTimestampQuery);

  // Metric Queries
  let existingSources = incrementalRefreshModel?.metricSources;
  let existingCovariateSources =
    incrementalRefreshModel?.metricCovariateSources;

  // Filter out metric source groups that belong to Fact Tables with new metrics
  // This forces a full refresh for those Fact Tables
  if (factTablesWithNewMetrics.size > 0) {
    const sourcesGroupIdsToDelete: string[] = [];
    existingSources?.forEach((source) => {
      // Exclude sources where any metric belongs to a Fact Table with new metrics
      return !source.metrics.some((m) => {
        const metric = metricMap.get(m.id);
        if (!metric || !isFactMetric(metric)) return false;
        const factTableId = metric.numerator?.factTableId;
        if (factTableId && factTablesWithNewMetrics.has(factTableId)) {
          sourcesGroupIdsToDelete.push(source.groupId);
        }
      });
    });
    existingSources = existingSources?.filter(
      (source) => !sourcesGroupIdsToDelete.includes(source.groupId),
    );
    existingCovariateSources = existingCovariateSources?.filter(
      (source) => !sourcesGroupIdsToDelete.includes(source.groupId),
    );
  }

  // Full refresh, pretend no existing sources
  // Will recreate sources with new random id for metric sources
  if (params.fullRefresh) {
    existingSources = [];
    existingCovariateSources = [];
  }

  if (selectedMetrics.some((m) => !isFactMetric(m))) {
    throw new Error(
      "Only fact metrics are supported with incremental refresh.",
    );
  }

  const metricSourceGroups = getIncrementalRefreshMetricSources(
    selectedMetrics.filter((m) => isFactMetric(m)),
    existingSources ?? [],
  );
  let runningSourceData = existingSources ?? [];
  let runningCovariateSourceData = existingCovariateSources ?? [];

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
          `${INCREMENTAL_METRICS_TABLE_PREFIX}_${group.groupId}`,
          settings.pipelineSettings?.writeDataset,
          settings.pipelineSettings?.writeDatabase,
          true,
        ));

    if (!metricSourceTableFullName) {
      throw new Error(
        "Unable to generate table; table path generator not specified.",
      );
    }

    const factTable = params.factTableMap.get(
      group.metrics[0].numerator?.factTableId,
    );

    // TODO(incremental-refresh): add metadata about source
    // in case same fact table is split across multiple sources
    const sourceName = factTable ? `(${factTable.name})` : "";

    let createMetricsSourceQuery: QueryPointer | null = null;
    if (!existingSource) {
      createMetricsSourceQuery = await startQuery({
        name: `create_metrics_source_${group.groupId}`,
        displayTitle: `Create Metrics Source ${sourceName}`,
        query: integration.getCreateMetricSourceTableQuery({
          settings: snapshotSettings,
          metrics: group.metrics,
          factTableMap: params.factTableMap,
          metricSourceTableFullName,
        }),
        dependencies: [alterUnitsTableQuery.query],
        run: (query, setExternalId) =>
          integration.runIncrementalWithNoOutputQuery(query, setExternalId),
        process: (rows) => rows,
        queryType: "experimentIncrementalRefreshCreateMetricsSourceTable",
      });
      queries.push(createMetricsSourceQuery);
    }

    const metricParams: InsertMetricSourceDataQueryParams = {
      settings: snapshotSettings,
      activationMetric: activationMetric,
      dimensions: [], // TODO(incremental-refresh): experiment dimensions
      factTableMap: params.factTableMap,
      metricSourceTableFullName,
      unitsSourceTableFullName: unitsTableFullName,
      metrics: group.metrics,
      lastMaxTimestamp: existingSource?.maxTimestamp ?? undefined,
    };

    const insertMetricsSourceDataQuery = await startQuery({
      name: `insert_metrics_source_data_${group.groupId}`,
      displayTitle: `Update Metrics Source ${sourceName}`,
      query: integration.getInsertMetricSourceDataQuery(metricParams),
      dependencies: createMetricsSourceQuery
        ? [createMetricsSourceQuery.query]
        : [alterUnitsTableQuery.query],
      run: (query, setExternalId) =>
        integration.runIncrementalWithNoOutputQuery(query, setExternalId),
      process: (rows) => rows,
      queryType: "experimentIncrementalRefreshInsertMetricsSourceData",
    });
    queries.push(insertMetricsSourceDataQuery);

    // CUPED tables
    const metricSourceCovariateTableFullName: string | undefined =
      integration.generateTablePath &&
      integration.generateTablePath(
        `${INCREMENTAL_METRICS_TABLE_PREFIX}_${group.groupId}_covariate`,
        settings.pipelineSettings?.writeDataset,
        settings.pipelineSettings?.writeDatabase,
        true,
      );
    if (!metricSourceCovariateTableFullName) {
      throw new Error(
        "Unable to generate table; table path generator not specified.",
      );
    }
    const anyMetricHasCuped = group.metrics.some((m) => {
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
        createMetricCovariateTableQuery = await startQuery({
          name: `create_metrics_covariate_table_${group.groupId}`,
          displayTitle: `Create Metric Covariate Table ${sourceName}`,
          query: integration.getCreateMetricSourceCovariateTableQuery({
            settings: snapshotSettings,
            metrics: group.metrics,
            metricSourceCovariateTableFullName,
          }),
          dependencies: [alterUnitsTableQuery.query],
          run: (query, setExternalId) =>
            integration.runIncrementalWithNoOutputQuery(query, setExternalId),
          process: (rows) => rows,
          queryType: "experimentIncrementalRefreshCreateMetricsCovariateTable",
        });
        queries.push(createMetricCovariateTableQuery);
      }

      insertMetricCovariateDataQuery = await startQuery({
        name: `insert_metrics_covariate_data_${group.groupId}`,
        displayTitle: `Update Metric Covariate Data ${sourceName}`,
        query: integration.getInsertMetricSourceCovariateDataQuery({
          ...metricParams,
          metricSourceCovariateTableFullName,
          incrementalRefreshStartTime: params.incrementalRefreshStartTime,
          lastCovariateSuccessfulUpdateTimestamp:
            existingCovariateSource?.lastCovariateSuccessfulUpdateTimestamp ??
            undefined,
        }),
        dependencies: createMetricCovariateTableQuery
          ? [createMetricCovariateTableQuery.query]
          : [alterUnitsTableQuery.query],
        run: (query, setExternalId) =>
          integration.runIncrementalWithNoOutputQuery(query, setExternalId),
        process: async (rows) => {
          const updatedCovariateSource: IncrementalRefreshMetricCovariateSourceInterface =
            existingCovariateSource
              ? {
                  ...existingCovariateSource,
                  lastCovariateSuccessfulUpdateTimestamp:
                    params.incrementalRefreshStartTime,
                }
              : {
                  groupId: group.groupId,
                  lastCovariateSuccessfulUpdateTimestamp:
                    params.incrementalRefreshStartTime,
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
          context.models.incrementalRefresh
            .upsertByExperimentId(params.queryParentId, {
              metricCovariateSources: runningCovariateSourceData,
            })
            .catch((e) => context.logger.error(e));
          return rows;
        },
        queryType: "experimentIncrementalRefreshInsertMetricsCovariateData",
      });
      queries.push(insertMetricCovariateDataQuery);
    }
    const metricSourceTablePartitionsName: string | undefined =
      existingSource?.tableFullName ??
      (integration.generateTablePath &&
        integration.generateTablePath(
          // `"${INCREMENTAL_METRICS_TABLE_PREFIX}_${group.groupId}$partitions"`,
          `${INCREMENTAL_METRICS_TABLE_PREFIX}_${group.groupId}`,
          settings.pipelineSettings?.writeDataset,
          settings.pipelineSettings?.writeDatabase,
          true,
        ));

    const maxTimestampMetricsSourceQuery = await startQuery({
      name: `max_timestamp_metrics_source_${group.groupId}`,
      displayTitle: `Find Latest Metrics Source Timestamp ${sourceName}`,
      query: integration.getMaxTimestampMetricSourceQuery({
        metricSourceTablePartitionsName:
          metricSourceTablePartitionsName ?? metricSourceTableFullName,
      }),
      dependencies: [insertMetricsSourceDataQuery.query],
      run: (query, setExternalId) =>
        integration.runMaxTimestampQuery(query, setExternalId),
      process: async (rows) => {
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
                  metrics: group.metrics.map((m) => ({
                    id: m.id,
                    // TODO(incremental-refresh): set this elsewhere?
                    settingsHash: getMetricSettingsHashForIncrementalRefresh({
                      factMetric: m,
                      factTableMap: params.factTableMap,
                      metricSettings: metricParams.settings.metricSettings.find(
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
          context.models.incrementalRefresh
            .upsertByExperimentId(params.queryParentId, {
              metricSources: runningSourceData,
            })
            .catch((e) => context.logger.error(e));
        }
        return rows;
      },
      queryType: "experimentIncrementalRefreshMaxTimestampMetricsSource",
    });
    queries.push(maxTimestampMetricsSourceQuery);

    const statisticsQuery = await startQuery({
      name: `statistics_${group.groupId}`,
      displayTitle: `Compute Statistics ${sourceName}`,
      query: integration.getIncrementalRefreshStatisticsQuery({
        ...metricParams,
        metricSourceCovariateTableFullName,
      }),
      dependencies: [
        insertMetricsSourceDataQuery.query,
        ...(insertMetricCovariateDataQuery
          ? [insertMetricCovariateDataQuery.query]
          : []),
      ],
      run: (query, setExternalId) =>
        integration.runIncrementalRefreshStatisticsQuery(query, setExternalId),
      process: (rows) => rows,
      queryType: "experimentIncrementalRefreshStatistics",
    });
    queries.push(statisticsQuery);
  }
  const runTrafficQuery =
    params.snapshotType === "standard" && org.settings?.runHealthTrafficQuery;

  if (runTrafficQuery) {
    const trafficQuery = await startQuery({
      name: TRAFFIC_QUERY_NAME,
      query: integration.getExperimentAggregateUnitsQuery({
        ...unitQueryParams,
        dimensions: experimentDimensions, // TODO(incremental-refresh): validate experiment dimensions are available
        useUnitsTable: true,
      }),
      dependencies: [alterUnitsTableQuery.query],
      run: (query, setExternalId) =>
        integration.runExperimentAggregateUnitsQuery(query, setExternalId),
      process: (rows) => rows,
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

    if (params.snapshotSettings.skipPartialData) {
      throw new Error(
        "'Exclude In-Progress Conversions' is not supported for incremental refresh queries while in beta. Please select 'Include' in the Analysis Settings for Metric Conversion Windows.",
      );
    }

    if (!this.integration.getSourceProperties().hasIncrementalRefresh) {
      throw new Error(
        "Integration does not support incremental refresh queries",
      );
    }

    return startExperimentIncrementalRefreshQueries(
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
    }

    return result;
  }

  async getLatestModel(): Promise<ExperimentSnapshotInterface> {
    const obj = await findSnapshotById(this.model.organization, this.model.id);
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
    const updates: Partial<ExperimentSnapshotInterface> = {
      queries,
      runStarted,
      error,
      ...result,
      status:
        status === "running"
          ? "running"
          : status === "failed"
            ? "error"
            : "success",
    };
    await updateSnapshot({
      organization: this.model.organization,
      id: this.model.id,
      updates,
      context: this.context,
    });
    if (
      this.model.report &&
      ["failed", "partially-succeeded", "succeeded"].includes(status)
    ) {
      await updateReport(this.model.organization, this.model.report, {
        snapshot: this.model.id,
      });
    }
    return {
      ...this.model,
      ...updates,
    };
  }
}
