import {
  expandMetricGroups,
  ExperimentMetricInterface,
  getAllMetricIdsFromExperiment,
  isFactMetric,
} from "shared/experiments";
import chunk from "lodash/chunk";
import { orgHasPremiumFeature } from "back-end/src/enterprise";
import { ApiReqContext } from "back-end/types/api";
import {
  ExperimentSnapshotInterface,
  ExperimentSnapshotSettings,
  SnapshotType,
} from "back-end/types/experiment-snapshot";
import { Queries, QueryPointer, QueryStatus } from "back-end/types/query";
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
import {
  getFactMetricGroup,
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
  fullRefresh: boolean;
};

// TODO(incremental-refresh): add metrics to existing metric source to force recreating the whole thing.
// UI side to let the user know a refresh will trigger restating the whole metric source.
export interface MetricSourceGroups {
  groupId: string;
  metrics: FactMetricInterface[];
}

function getIncrementalRefreshMetricSources(
  metrics: FactMetricInterface[],
  existingMetricSources: IncrementalRefreshInterface["metricSources"],
): {
  metrics: FactMetricInterface[];
  groupId: string;
}[] {
  // TODO(incremental-refresh): skip partial data is currently ignored
  // TODO(incremental-refresh): error if no efficient percentiles
  // (shouldn't be possible since we are unlikely to build incremental
  // refresh for mySQL
  const groups: Record<
    string,
    {
      alreadyExists: boolean;
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
        metrics: [],
      };
      groups[existingGroup.groupId].metrics.push(metric);
      return;
    }

    const group = getFactMetricGroup(metric) ?? metric.id;
    groups[group] = groups[group] || {
      alreadyExists: false,
      metrics: [],
    };
    groups[group].metrics.push(metric);
  });

  const finalGroups: {
    groupId: string;
    metrics: FactMetricInterface[];
  }[] = [];
  Object.entries(groups).forEach(([groupId, group]) => {
    if (group.alreadyExists) {
      finalGroups.push({
        groupId,
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
  const snapshotSettings: ExperimentSnapshotSettings = {
    ...params.snapshotSettings,
    // TODO(incremental-refresh): enable CUPED
    regressionAdjustmentEnabled: false,
  };
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

  // Only include metrics tied to this experiment (both goal and guardrail metrics)
  const allMetricGroups = await context.models.metricGroups.getAll();
  const selectedMetrics = expandMetricGroups(
    getAllMetricIdsFromExperiment(snapshotSettings, false),
    allMetricGroups,
  )
    .map((m) => metricMap.get(m))
    .filter((m) => m) as ExperimentMetricInterface[];
  if (!selectedMetrics.length) {
    throw new Error("Experiment must have at least 1 metric selected.");
  }

  const canRunIncrementalRefreshQueries =
    hasIncrementalRefreshFeature &&
    settings.pipelineSettings?.mode === "incremental";

  // TODO(incremental-refresh): error instead of fall back?
  const partitionSettings = integration.datasource.settings.pipelineSettings
    ?.partitionSettings ?? {
    type: "timestamp",
  };

  const queries: Queries = [];

  if (!canRunIncrementalRefreshQueries) {
    throw new Error("Integration does not support incremental refresh queries");
  }

  const unitsTableFullName =
    integration.generateTablePath &&
    integration.generateTablePath(
      `${INCREMENTAL_UNITS_TABLE_PREFIX}_${queryParentId}`,
      settings.pipelineSettings?.writeDataset,
      settings.pipelineSettings?.writeDatabase,
      true,
    );
  if (!unitsTableFullName) {
    throw new Error(
      "Unable to generate table; table path generator not specified.",
    );
  }

  function trimQuotes(str: string): string {
    return str.replace(/^[`'"]+|[`'"]+$/g, "");
  }

  const randomId = Math.random().toString(36).substring(2, 10);
  const unitsTempTableFullName = `\`${trimQuotes(unitsTableFullName)}_temp_${randomId}\``;

  const incrementalRefreshModel =
    await context.models.incrementalRefresh.getByExperimentId(
      // FIX-ME(incremental-refresh): This is the experimentId, and snapshotSettings.experimentId is the trackingKey
      params.queryParentId,
    );

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

      // Error if a selected metric is not present in incremental refresh sources
      for (const m of selectedFactMetrics) {
        if (!storedMetricIds.has(m.id)) {
          const metricName = m.name ?? m.id;
          throw new Error(
            `The metric "${metricName}" was added. Please run a Full Refresh.`,
          );
        }
      }

      // Error if incremental refresh has a metric that is no longer in settings
      for (const storedId of storedMetricIds) {
        if (!selectedFactMetricIds.has(storedId)) {
          const metricName = metricMap.get(storedId)?.name ?? storedId;
          throw new Error(
            `The metric "${metricName}" has been removed. Please run a Full Refresh.`,
          );
        }
      }

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
    factTableMap: params.factTableMap,
    lastMaxTimestamp: lastMaxTimestamp,
    partitionSettings:
      integration.datasource.settings.pipelineSettings?.partitionSettings,
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
      title: "Create Experiment Units Table",
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
    title: "Update Experiment Units Table",
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
    title: "Drop Old Experiment Units Table",
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
    title: "Rename Experiment Units Table",
    query: integration.getAlterNewIncrementalUnitsQuery({
      unitsTableFullName: unitsTableFullName,
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
    title: "Find Latest Experiment Source Timestamp",
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

  // Full refresh, pretend no existing sources
  // Will recreate sources with new random id for metric sources
  if (params.fullRefresh) {
    existingSources = [];
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

  for (const group of metricSourceGroups) {
    const existingSource = existingSources?.find(
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
        title: `Create Metrics Source ${sourceName}`,
        query: integration.getCreateMetricSourceTableQuery({
          settings: snapshotSettings,
          metrics: group.metrics,
          factTableMap: params.factTableMap,
          partitionSettings: partitionSettings,
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
      partitionSettings: partitionSettings,
      lastMaxTimestamp: existingSource?.maxTimestamp ?? undefined,
    };

    const insertMetricsSourceDataQuery = await startQuery({
      name: `insert_metrics_source_data_${group.groupId}`,
      title: `Update Metrics Source ${sourceName}`,
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
      title: `Find Latest Metrics Source Timestamp ${sourceName}`,
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
      title: `Compute Statistics ${sourceName}`,
      query: integration.getIncrementalRefreshStatisticsQuery(metricParams),
      dependencies: [insertMetricsSourceDataQuery.query],
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
