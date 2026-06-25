import {
  ExperimentMetricInterface,
  isFactMetric,
  isRatioMetric,
} from "shared/experiments";
import { Dimension } from "shared/types/integrations";
import { FactMetricInterface } from "shared/types/fact-table";
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
import { ApiReqContext } from "back-end/types/api";
import {
  findSnapshotById,
  updateSnapshot,
} from "back-end/src/models/ExperimentSnapshotModel";
import { getIncrementalRefreshMetricSources } from "back-end/src/queryRunners/ExperimentIncrementalRefreshQueryRunner";
import {
  hasAnyRegressionAdjustedMetric,
  planMetricFanOut,
} from "back-end/src/services/experimentQueries/planMetricFanOut";
import { buildCrossFtSubGroups } from "back-end/src/services/experimentQueries/crossFtSubGroups";
import { SourceIntegrationInterface } from "back-end/src/types/Integration";
import { FactTableMap } from "back-end/src/models/FactTableModel";
import { updateReport } from "back-end/src/models/ReportModel";
import { parseDimension } from "back-end/src/services/experiments";
import { analyzeExperimentResults } from "back-end/src/services/stats";
import { assertIncrementalRefreshPrerequisites } from "back-end/src/enterprise/services/data-pipeline";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import {
  QueryRunner,
  QueryMap,
  ProcessedRowsType,
  RowsType,
  StartQueryParams,
} from "./QueryRunner";
import { SnapshotResult } from "./ExperimentResultsQueryRunner";

export type ExperimentIncrementalRefreshExploratoryQueryParams = {
  snapshotType: SnapshotType;
  snapshotSettings: ExperimentSnapshotSettings;
  variationNames: string[];
  metricMap: Map<string, ExperimentMetricInterface>;
  factTableMap: FactTableMap;
  experimentId: string;
  experimentQueryMetadata: ExperimentQueryMetadata | null;
  queryParentId: string;
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

  const activationMetric = snapshotSettings.activationMetric
    ? (metricMap.get(snapshotSettings.activationMetric) ?? null)
    : null;

  const exposureQuery = (
    integration.datasource.settings?.queries?.exposure || []
  ).find((q) => q.id === snapshotSettings.exposureQueryId);

  if (!exposureQuery) {
    throw new Error("Exposure query not found");
  }

  const resolvedExposureQuery = {
    query: exposureQuery.query,
    userIdType: exposureQuery.userIdType,
  };

  // Only include metrics tied to this experiment, which is goverend by the snapshotSettings.metricSettings
  // after the introduction of metric slices
  const selectedMetrics = snapshotSettings.metricSettings
    .map((m) => metricMap.get(m.id))
    .filter((m) => m) as ExperimentMetricInterface[];

  const queries: Queries = [];

  const incrementalRefreshModel =
    await context.models.incrementalRefresh.getByExperimentId(experimentId);

  if (!incrementalRefreshModel) {
    throw new Error(
      "Incremental refresh model not found; the overall results must be created before exploratory analyses can be run.",
    );
  }

  const dimensionObjs: Dimension[] = (
    await Promise.all(
      snapshotSettings.dimensions.map(
        async (d) => await parseDimension(d.id, d.slices, org.id),
      ),
    )
  ).filter((d): d is Dimension => d !== null);

  const missingExperimentDimensions = dimensionObjs.filter(
    (d) =>
      d.type === "experiment" &&
      !incrementalRefreshModel.unitsDimensions.includes(d.id),
  );

  if (missingExperimentDimensions.length) {
    throw new Error(
      `Selected dimensions are not in the incremental refresh model; required for exploratory analysis.`,
    );
  }

  const unitsTableFullName = incrementalRefreshModel.unitsTableFullName;

  if (!unitsTableFullName) {
    throw new Error(
      "Units table not found in incremental refresh model; required for exploratory analysis.",
    );
  }

  const executionId = params.queryParentId;

  // Wraps a `run` callback with an execution-fence check. The exploratory
  // runner only reads the shared per-experiment pipeline tables, but it holds
  // the same lock the incremental runner uses to DROP/CREATE/RENAME them. If
  // the lock is taken over by another snapshot mid-run (stale heartbeat,
  // cancel + restart), continuing to SELECT from those tables would observe a
  // missing or half-rebuilt table and return empty/malformed results. Checked
  // at execute time (not enqueue time) because queries run sequentially via
  // dependencies — the lock can be lost between dependent queries.
  const fenced =
    <A extends unknown[], R>(run: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      const current =
        await context.models.incrementalRefresh.getCurrentExecutionSnapshotId(
          experimentId,
        );
      if (current !== executionId) {
        throw new Error(
          "Incremental refresh lock was lost to another snapshot; aborting exploratory analysis to avoid reading half-rebuilt pipeline tables.",
        );
      }
      return run(...args);
    };

  // Metric Queries
  const existingSources = incrementalRefreshModel?.metricSources;
  const existingCovariateSources =
    incrementalRefreshModel?.metricCovariateSources;

  const factMetrics = selectedMetrics.filter((m): m is FactMetricInterface =>
    isFactMetric(m),
  );

  const metricSourceGroups = getIncrementalRefreshMetricSources({
    metrics: factMetrics,
    existingMetricSources: existingSources ?? [],
    integration,
    snapshotSettings,
  });

  // Mirror the main runner: metrics whose numerator and denominator both
  // live in one FT get a stats query against that FT's cache, then we do
  // a second pass over cross-FT ratio metric pairs and emit one joined
  // stats query per pair (so dimension breakdowns on cross-FT ratios work
  // the same way they do for single-table metrics).
  interface ExploratoryPipeline {
    group: (typeof metricSourceGroups)[number];
    tableFullName: string;
    // Optional covariate cache, populated when at least one metric in the
    // group is regression-adjusted (same-FT or cross-FT).
    covariateTableFullName?: string;
  }
  const pipelineByGroupId = new Map<string, ExploratoryPipeline>();

  for (const group of metricSourceGroups) {
    const existingSource = existingSources?.find(
      (s) => s.groupId === group.groupId,
    );
    if (!existingSource) {
      // skip in case the group just has new metrics
      continue;
    }

    const existingCovariateSource = existingCovariateSources?.find(
      (s) => s.groupId === group.groupId,
    );

    // Evaluate CUPED across the full group — same-FT and cross-FT metrics
    // both rely on the same per-FT covariate cache, so a missing one is a
    // hard failure regardless of which pass would consume it.
    const anyMetricHasCuped = hasAnyRegressionAdjustedMetric(
      group.metrics,
      snapshotSettings,
    );

    if (anyMetricHasCuped && !existingCovariateSource) {
      throw new Error(
        `Metric source group ${group.groupId} has CUPED metrics but no covariate source found.`,
      );
    }

    pipelineByGroupId.set(group.groupId, {
      group,
      tableFullName: existingSource.tableFullName,
      covariateTableFullName: anyMetricHasCuped
        ? existingCovariateSource?.tableFullName
        : undefined,
    });

    // Same-FT stats only run when this cache hosts at least one metric whose
    // numerator and denominator both live in this FT. Caches that contain
    // only one side of a cross-FT ratio sit out this pass — their stats
    // live in the cross-FT pair pass below.
    const sameFtMetrics = group.metrics.filter(
      (m) =>
        m.numerator.factTableId === group.factTableId &&
        (!isRatioMetric(m) || m.denominator?.factTableId === group.factTableId),
    );
    if (sameFtMetrics.length === 0) continue;

    const factTable = params.factTableMap.get(group.factTableId);

    // TODO(incremental-refresh): add metadata about source
    // in case same fact table is split across multiple sources
    const sourceName = factTable ? `(${factTable.name})` : "";

    const statisticsQuery = await startQuery({
      name: `statistics_${group.groupId}`,
      displayTitle: `Compute Statistics ${sourceName}`,
      query: integration.getIncrementalRefreshStatisticsQuery({
        settings: snapshotSettings,
        exposureQuery: resolvedExposureQuery,
        activationMetric: activationMetric,
        // TODO(incremental-refresh): add post-stratification to exploratory
        // analysis. Pre-computation is unused here; we lean on
        // dimensionsForAnalysis to drive breakdowns instead.
        dimensionsForPrecomputation: [],
        dimensionsForAnalysis: dimensionObjs,
        factTableMap: params.factTableMap,
        metricSources: [
          {
            factTableId: group.factTableId,
            tableFullName: existingSource.tableFullName,
            ...(anyMetricHasCuped && existingCovariateSource
              ? {
                  covariateTableFullName: existingCovariateSource.tableFullName,
                }
              : {}),
          },
        ],
        unitsSourceTableFullName: unitsTableFullName,
        metrics: sameFtMetrics,
        lastMaxTimestamp: existingSource?.maxTimestamp || null,
      }),
      dependencies: [],
      run: fenced((query, setExternalId, queryMetadata) =>
        integration.runIncrementalRefreshStatisticsQuery(
          query,
          setExternalId,
          queryMetadata,
        ),
      ),
      queryType: "experimentIncrementalRefreshStatistics",
    });
    queries.push(statisticsQuery);
  }

  // Cross-FT pair pass — mirrors the main runner. We re-derive the
  // numerator/denominator orientation per metric from planMetricFanOut and
  // look up each side's cache from the existing source list. If either
  // side hasn't been built yet (e.g. the user is asking for exploratory
  // analysis before the first cross-FT main run completes), we soft-skip
  // the pair rather than fail — the next main run will materialize both
  // halves.
  const fanOut = planMetricFanOut(factMetrics);
  const crossFtSubGroups = buildCrossFtSubGroups<ExploratoryPipeline>({
    crossFtPairs: fanOut.crossFtPairs,
    metricSourceGroups,
    pipelineByGroupId,
    onMissingPipeline: "skip",
  });
  for (const subGroup of crossFtSubGroups) {
    const [pipelineA, pipelineB] = subGroup.pipelines;
    const ftA = params.factTableMap.get(pipelineA.group.factTableId);
    const ftB = params.factTableMap.get(pipelineB.group.factTableId);
    const sourceName = ftA && ftB ? `(${ftA.name} x ${ftB.name})` : "";

    const crossStatsQuery = await startQuery({
      name: `statistics_cross_${pipelineA.group.groupId}__${pipelineB.group.groupId}`,
      displayTitle: `Compute Cross-Fact Statistics ${sourceName}`,
      query: integration.getIncrementalRefreshStatisticsQuery({
        settings: snapshotSettings,
        exposureQuery: resolvedExposureQuery,
        activationMetric: activationMetric,
        dimensionsForPrecomputation: [],
        dimensionsForAnalysis: dimensionObjs,
        factTableMap: params.factTableMap,
        unitsSourceTableFullName: unitsTableFullName,
        metrics: subGroup.metrics.map((m) => m.metric),
        lastMaxTimestamp: null,
        // Cross-FT CUPED reads each side's covariate cache. Either
        // pipeline may have none (if its metrics aren't RA), and we omit
        // `covariateTableFullName` in that case.
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
      dependencies: [],
      run: fenced((query, setExternalId, queryMetadata) =>
        integration.runIncrementalRefreshStatisticsQuery(
          query,
          setExternalId,
          queryMetadata,
        ),
      ),
      queryType: "experimentIncrementalRefreshStatistics",
    });
    queries.push(crossStatsQuery);
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
    params: ExperimentIncrementalRefreshExploratoryQueryParams,
  ): Promise<Queries> {
    this.metricMap = params.metricMap;
    this.variationNames = params.variationNames;
    if (params.experimentQueryMetadata) {
      this.integration.setAdditionalQueryMetadata?.(
        params.experimentQueryMetadata,
      );
    }

    const incrementalRefreshModel =
      await this.context.models.incrementalRefresh.getByExperimentId(
        params.experimentId,
      );

    const experiment = await getExperimentById(
      this.context,
      params.experimentId,
    );
    if (!experiment) {
      throw new Error("Experiment not found");
    }

    await assertIncrementalRefreshPrerequisites({
      org: this.context.org,
      integration: this.integration,
      snapshotSettings: params.snapshotSettings,
      metricMap: params.metricMap,
      experiment,
      incrementalRefreshModel,
      analysisType: "exploratory",
    });

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

    // Release the incremental refresh lock on any terminal status. This runner
    // acquires the lock (see createSnapshotFromPlan) so that it does not read
    // the shared pipeline tables while an incremental refresh is mutating them.
    if (updates.status !== "running") {
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
