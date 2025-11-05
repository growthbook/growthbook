import { ExperimentMetricInterface, isFactMetric } from "shared/experiments";
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
  getIncrementalRefreshMetricSources,
  INCREMENTAL_METRICS_TABLE_PREFIX,
  INCREMENTAL_UNITS_TABLE_PREFIX,
} from "back-end/src/queryRunners/ExperimentIncrementalRefreshQueryRunner";
import {
  Dimension,
  ExperimentAggregateUnitsQueryResponseRows,
  IncrementalRefreshStatisticsQueryParams,
  SourceIntegrationInterface,
} from "back-end/src/types/Integration";
import { FactTableMap } from "back-end/src/models/FactTableModel";
import { updateReport } from "back-end/src/models/ReportModel";
import { FactMetricInterface } from "back-end/types/fact-table";
import { parseDimension } from "back-end/src/services/experiments";
import {
  analyzeExperimentResults,
  analyzeExperimentTraffic,
} from "back-end/src/services/stats";
import { getMetricSettingsHashForIncrementalRefresh } from "back-end/src/services/experimentTimeSeries";
import { SegmentInterface } from "back-end/types/segment";
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

export type ExperimentIncrementalRefreshExploratoryQueryParams = {
  snapshotType: SnapshotType;
  snapshotSettings: ExperimentSnapshotSettings;
  variationNames: string[];
  metricMap: Map<string, ExperimentMetricInterface>;
  factTableMap: FactTableMap;
  experimentId: string;
  experimentQueryMetadata: ExperimentQueryMetadata | null;
  // Incremental Refresh specific
  incrementalRefreshStartTime: Date;
};

export const startExperimentIncrementalRefreshExploratoryQueries = async (
  context: ApiReqContext,
  params: ExperimentIncrementalRefreshExploratoryQueryParams,
  integration: SourceIntegrationInterface,
  startQuery: (
    params: StartQueryParams<RowsType, ProcessedRowsType>,
  ) => Promise<QueryPointer>,
): Promise<Queries> => {
  const snapshotSettings = params.snapshotSettings;
  const experimentId = params.experimentId;
  const metricMap = params.metricMap;

  const { org } = context;
  const hasIncrementalRefreshFeature = orgHasPremiumFeature(
    org,
    "incremental-refresh",
  );

  const activationMetric = snapshotSettings.activationMetric
    ? (metricMap.get(snapshotSettings.activationMetric) ?? null)
    : null;

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

  console.log(experimentId);
  const incrementalRefreshModel =
    await context.models.incrementalRefresh.getByExperimentId(experimentId);

  if (!incrementalRefreshModel) {
    throw new Error(
      "Incremental refresh model not found; required for dimension update.",
    );
  }

  const unitsTableFullName = incrementalRefreshModel.unitsTableFullName;

  if (!unitsTableFullName) {
    throw new Error(
      "Units table not found in incremental refresh model; required for dimension update.",
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
    const selectedExistingFactMetrics = selectedMetrics.filter(
      (m) => isFactMetric(m) && storedMetricIds.has(m.id),
    );

    // TODO deal with changed metric values? Just warn?
    selectedExistingFactMetrics
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

  // Metric Queries
  const existingSources = incrementalRefreshModel?.metricSources;
  console.log(existingSources);
  const existingCovariateSources =
    incrementalRefreshModel?.metricCovariateSources;

  if (selectedMetrics.some((m) => !isFactMetric(m))) {
    throw new Error(
      "Only fact metrics are supported with incremental refresh.",
    );
  }

  const metricSourceGroups = getIncrementalRefreshMetricSources(
    selectedMetrics.filter((m) => isFactMetric(m)),
    existingSources ?? [],
  );
  // TODO ignore new metrics that are not in existing source

  for (const group of metricSourceGroups) {
    const existingSource = existingSources?.find(
      (s) => s.groupId === group.groupId,
    );

    const existingCovariateSource = existingCovariateSources?.find(
      (s) => s.groupId === group.groupId,
    );

    // TODO validate covariate source exists if it is supposed to?
    if (!existingSource) {
      throw new Error(
        `Metric source group ${group.groupId} not found in incremental refresh model.`,
      );
    }

    const factTable = params.factTableMap.get(
      group.metrics[0].numerator?.factTableId,
    );

    // TODO(incremental-refresh): add metadata about source
    // in case same fact table is split across multiple sources
    const sourceName = factTable ? `(${factTable.name})` : "";

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

    const dimensionObjs: Dimension[] = (
      await Promise.all(
        snapshotSettings.dimensions.map(
          async (d) => await parseDimension(d.id, d.slices, org.id),
        ),
      )
    ).filter((d): d is Dimension => d !== null);

    // Return statistics
    const metricParams: IncrementalRefreshStatisticsQueryParams = {
      settings: snapshotSettings,
      activationMetric: activationMetric,
      dimensions: dimensionObjs,
      factTableMap: params.factTableMap,
      metricSourceTableFullName: existingSource.tableFullName,
      metricSourceCovariateTableFullName: metricSourceCovariateTableFullName,
      unitsSourceTableFullName: unitsTableFullName,
      metrics: group.metrics,
      lastMaxTimestamp: existingSource?.maxTimestamp || null,
    };
    const statisticsQuery = await startQuery({
      name: `statistics_${group.groupId}`,
      displayTitle: `Compute Statistics ${sourceName}`,
      query: integration.getIncrementalRefreshStatisticsQuery(metricParams),
      dependencies: [],
      run: (query, setExternalId) =>
        integration.runIncrementalRefreshStatisticsQuery(query, setExternalId),
      process: (rows) => rows,
      queryType: "experimentIncrementalRefreshStatistics",
    });
    queries.push(statisticsQuery);
  }
  return queries;
};

export class ExperimentIncrementalRefreshExploratoryQueryRunner extends QueryRunner<
  ExperimentSnapshotInterface,
  ExperimentIncrementalRefreshExploratoryQueryParams,
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
    params: ExperimentIncrementalRefreshExploratoryQueryParams,
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

    // TODO full refresh should not be possible with dimension selected
    if (!this.integration.getSourceProperties().hasIncrementalRefresh) {
      throw new Error(
        "Integration does not support incremental refresh queries",
      );
    }

    return startExperimentIncrementalRefreshExploratoryQueries(
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

    // TODO run health checks?

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
