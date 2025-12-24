import {
  ExperimentMetricInterface,
  isFactMetric,
  isRegressionAdjusted,
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
import { getExperimentById } from "../models/ExperimentModel";
import { applyMetricOverrides } from "../util/integration";
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
}): {
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
    const chunks = chunkMetrics({
      metrics: group.metrics.map((m) => {
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
      bandit: !!snapshotSettings.banditSettings,
    });
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

  // When adding new metrics to a fact table, we will need to scan the whole table.
  // So to simplify things we re-create the whole metric source.
  // When removing metrics this is not needed, we just don't insert updated data.
  const factTablesWithNewMetrics = new Set<string>();

  // If not forcing a full refresh and we have a previous run, ensure the
  // current configuration matches what the incremental pipeline was built with.
  if (incrementalRefreshModel && incrementalRefreshModel.metricSources.length) {
    const existingMetricSourcesMetricIds = new Set<string>();
    incrementalRefreshModel.metricSources.forEach((source) => {
      source.metrics.forEach((metric) => {
        existingMetricSourcesMetricIds.add(metric.id);
      });
    });

    // New metrics that we don't have incremental data for
    const addedMetrics = new Set<FactMetricInterface>();
    for (const m of selectedMetrics) {
      if (!existingMetricSourcesMetricIds.has(m.id)) {
        // Should never happen as this only supports fact metrics
        if (!isFactMetric(m)) {
          throw new Error(
            "Only fact metrics are supported with incremental refresh.",
          );
        }
        addedMetrics.add(m);
      }
    }

    const selectedMetricIds = new Set<string>(selectedMetrics.map((m) => m.id));

    const removedMetricIds = new Set<string>();
    for (const storedId of existingMetricSourcesMetricIds) {
      if (!selectedMetricIds.has(storedId)) {
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
      run: (query, setExternalId) =>
        integration.runDropTableQuery(query, setExternalId),
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
    run: (query, setExternalId) =>
      integration.runIncrementalWithNoOutputQuery(query, setExternalId),
    onSuccess: (rows) => {
      // TODO(incremental-refresh): Clean up metadata handling in query runner
      const maxTimestamp = new Date(rows[0].max_timestamp as string);

      if (maxTimestamp) {
        context.models.incrementalRefresh
          .upsertByExperimentId(experimentId, {
            unitsTableFullName: unitsTableFullName,
            unitsMaxTimestamp: maxTimestamp,
            experimentSettingsHash:
              getExperimentSettingsHashForIncrementalRefresh(snapshotSettings),
            unitsDimensions: eligibleDimensions.map((d) => d.id),
          })
          .catch((e) => context.logger.error(e));
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

  const metricSourceGroups = getIncrementalRefreshMetricSources({
    metrics: selectedMetrics.filter((m) => isFactMetric(m)),
    existingMetricSources: existingSources ?? [],
    integration,
    snapshotSettings,
  });
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
        dependencies: [updateUnitsTableQuery.query],
        run: (query, setExternalId) =>
          integration.runIncrementalWithNoOutputQuery(query, setExternalId),
        queryType: "experimentIncrementalRefreshCreateMetricsSourceTable",
      });
      queries.push(createMetricsSourceQuery);
    }

    const metricParams: InsertMetricSourceDataQueryParams = {
      settings: snapshotSettings,
      activationMetric: activationMetric,
      factTableMap: params.factTableMap,
      metricSourceTableFullName,
      unitsSourceTableFullName: unitsTableFullName,
      metrics: group.metrics,
      lastMaxTimestamp: existingSource?.maxTimestamp || null,
    };

    const insertMetricsSourceDataQuery = await startQuery({
      name: `insert_metrics_source_data_${group.groupId}`,
      displayTitle: `Update Metrics Source ${sourceName}`,
      query: integration.getInsertMetricSourceDataQuery(metricParams),
      dependencies: [
        ...(createMetricsSourceQuery ? [createMetricsSourceQuery.query] : []),
        alterUnitsTableQuery.query,
      ],
      run: (query, setExternalId) =>
        integration.runIncrementalWithNoOutputQuery(query, setExternalId),
      queryType: "experimentIncrementalRefreshInsertMetricsSourceData",
    });
    queries.push(insertMetricsSourceDataQuery);

    // CUPED tables
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
        // Safety net in case our data model is out of sync with the database
        const dropMetricCovariateTableQuery = await startQuery({
          name: `drop_metrics_covariate_table_${group.groupId}`,
          displayTitle: `Drop Old Metric Covariate Table ${sourceName}`,
          query: integration.getDropMetricSourceCovariateTableQuery({
            metricSourceCovariateTableFullName,
          }),
          dependencies: [updateUnitsTableQuery.query],
          run: (query, setExternalId) =>
            integration.runDropTableQuery(query, setExternalId),
          queryType: "experimentIncrementalRefreshDropMetricsCovariateTable",
        });
        queries.push(dropMetricCovariateTableQuery);

        createMetricCovariateTableQuery = await startQuery({
          name: `create_metrics_covariate_table_${group.groupId}`,
          displayTitle: `Create Metric Covariate Table ${sourceName}`,
          query: integration.getCreateMetricSourceCovariateTableQuery({
            settings: snapshotSettings,
            metrics: group.metrics,
            metricSourceCovariateTableFullName,
          }),
          dependencies: [dropMetricCovariateTableQuery.query],
          run: (query, setExternalId) =>
            integration.runIncrementalWithNoOutputQuery(query, setExternalId),
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
          lastCovariateSuccessfulMaxTimestamp:
            existingCovariateSource?.lastSuccessfulMaxTimestamp || null,
        }),
        dependencies: [
          maxTimestampUnitsTableQuery.query,
          ...(createMetricCovariateTableQuery
            ? [createMetricCovariateTableQuery.query]
            : []),
        ],
        run: (query, setExternalId) =>
          integration.runIncrementalWithNoOutputQuery(query, setExternalId),
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
          context.models.incrementalRefresh
            .upsertByExperimentId(experimentId, {
              metricCovariateSources: runningCovariateSourceData,
            })
            .catch((e) => context.logger.error(e));
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
      run: (query, setExternalId) =>
        integration.runMaxTimestampQuery(query, setExternalId),
      onFailure: async () => {
        // Remove the source from the running data if max timestamp fails
        runningSourceData = runningSourceData.filter(
          (s) => s.groupId !== group.groupId,
        );
        await context.models.incrementalRefresh.upsertByExperimentId(
          experimentId,
          {
            metricSources: runningSourceData,
          },
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
            .upsertByExperimentId(experimentId, {
              metricSources: runningSourceData,
            })
            .catch((e) => context.logger.error(e));
        }
      },
      queryType: "experimentIncrementalRefreshMaxTimestampMetricsSource",
    });
    queries.push(maxTimestampMetricsSourceQuery);

    const statisticsQuery = await startQuery({
      name: `statistics_${group.groupId}`,
      displayTitle: `Compute Statistics ${sourceName}`,
      query: integration.getIncrementalRefreshStatisticsQuery({
        ...metricParams,
        dimensionsForPrecomputation: eligibleDimensionsWithSlicesUnderMaxCells,
        dimensionsForAnalysis: [],
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
        dimensions: eligibleDimensionsWithSlices,
        useUnitsTable: true,
      }),
      dependencies: [alterUnitsTableQuery.query],
      run: (query, setExternalId) =>
        integration.runExperimentAggregateUnitsQuery(query, setExternalId),
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
