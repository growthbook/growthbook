import { QueryRunnerRunTargetType } from "shared/validators";
import {
  ExperimentMetricInterface,
  getFactMetricFactTableIds,
  isFactFunnelMetric,
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
  errorSnapshotIfStillRunning,
  findSnapshotById,
  updateSnapshot,
} from "back-end/src/models/ExperimentSnapshotModel";
import { getIncrementalRefreshMetricSources } from "back-end/src/queryRunners/ExperimentIncrementalRefreshQueryRunner";
import {
  hasAnyRegressionAdjustedMetric,
  planMetricFanOut,
} from "back-end/src/services/experimentQueries/planMetricFanOut";
import { buildMultiSourceSubGroups } from "back-end/src/services/experimentQueries/multiSourceSubGroups";
import {
  conversionWindowMinutesKey,
  conversionWindowQueryNameSuffix,
  getOverriddenMetricConversionWindowHours,
  partitionMetricsByConversionWindow,
} from "back-end/src/services/experimentQueries/partitionMetricsByConversionWindow";
import { getQueryableMetricsFromSnapshotSettings } from "back-end/src/services/experimentQueries/experimentQueries";
import { SourceIntegrationInterface } from "back-end/src/types/Integration";
import { FactTableMap } from "back-end/src/models/FactTableModel";
import { updateReport } from "back-end/src/models/ReportModel";
import { parseDimension } from "back-end/src/services/experiments";
import { analyzeExperimentResults } from "back-end/src/services/stats";
import { assertIncrementalRefreshPrerequisites } from "back-end/src/enterprise/services/data-pipeline";
import { ExperimentIncrementalPipelineRequiresFullRefreshError } from "back-end/src/util/errors";
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
  /** When the incremental refresh started. */
  incrementalRefreshStartTime: Date;
  /** The date to use for units date so we don't include units past the last overall update. Needed for exploratory incremental. */
  asOf?: Date;
};

export const startExperimentIncrementalRefreshExploratoryQueries = async (
  context: ApiReqContext,
  params: ExperimentIncrementalRefreshExploratoryQueryParams,
  integration: SourceIntegrationInterface,
  startQuery: (
    params: StartQueryParams<RowsType, ProcessedRowsType>,
  ) => Promise<QueryPointer>,
): Promise<Queries> => {
  const { snapshotSettings, experimentId, metricMap } = params;

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
  const selectedMetrics = getQueryableMetricsFromSnapshotSettings(
    snapshotSettings,
    metricMap,
  );

  const queries: Queries = [];

  const incrementalRefreshModel =
    await context.models.incrementalRefresh.getLockedBySnapshotId(
      experimentId,
      params.queryParentId,
    );

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

  // Experiment dimensions must be materialized on the incremental units
  // table, including any inside a combo; other types compute at query time
  const requiredExperimentDimensionIds = dimensionObjs.flatMap((d) =>
    d.type === "experiment"
      ? [d.id]
      : d.type === "combo"
        ? d.dimensions.flatMap((c) => (c.type === "experiment" ? [c.id] : []))
        : [],
  );
  const missingExperimentDimensions = requiredExperimentDimensionIds.filter(
    (id) => !incrementalRefreshModel.unitsDimensions.includes(id),
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

  const asOf = params.asOf;
  if (snapshotSettings.skipPartialData && !asOf) {
    throw new ExperimentIncrementalPipelineRequiresFullRefreshError(
      "Overall Results require a full refresh before Dimension Results can exclude in-progress conversions.",
    );
  }

  const executionId = params.queryParentId;

  // Dependencies can delay a query until another snapshot takes over the lock.
  const fenced =
    <A extends unknown[], R>(run: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      const lockHeld =
        await context.models.incrementalRefresh.isLockedBySnapshotId(
          experimentId,
          executionId,
        );
      if (!lockHeld) {
        throw new Error(
          "Incremental refresh lock was lost to another snapshot; aborting exploratory analysis to avoid reading half-rebuilt pipeline tables.",
        );
      }
      return run(...args);
    };

  // Metric Queries
  const existingSources = incrementalRefreshModel.metricSources;
  const existingCovariateSources =
    incrementalRefreshModel.metricCovariateSources;

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
    // data is fully present in this FT. Cross-FT ratios and multifact
    // funnels are handled in dedicated passes below.
    const sameFtMetrics = group.metrics.filter((m) => {
      if (isFactFunnelMetric(m)) {
        const ftIds = [...new Set(getFactMetricFactTableIds(m))];
        return ftIds.length === 1;
      }
      return (
        m.numerator?.factTableId === group.factTableId &&
        (!isRatioMetric(m) || m.denominator?.factTableId === group.factTableId)
      );
    });
    if (sameFtMetrics.length === 0) continue;

    const factTable = params.factTableMap.get(group.factTableId);

    // TODO(incremental-refresh): add metadata about source
    // in case same fact table is split across multiple sources
    const sourceName = factTable ? `(${factTable.name})` : "";

    // Mainly for skipPartialData / conversionWindow
    // We partition the stats query by conversion window over the same shared table.
    const partitions = partitionMetricsByConversionWindow(
      sameFtMetrics,
      snapshotSettings.skipPartialData,
      activationMetric,
    );
    for (const partition of partitions) {
      const statisticsQuery = await startQuery({
        name: `statistics_${group.groupId}${conversionWindowQueryNameSuffix(partition.window?.key)}`,
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
                    covariateTableFullName:
                      existingCovariateSource.tableFullName,
                  }
                : {}),
            },
          ],
          unitsSourceTableFullName: unitsTableFullName,
          metrics: partition.metrics,
          lastMaxTimestamp: existingSource?.maxTimestamp || null,
          asOf,
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
  }

  // Multi-source pass — mirrors the main runner. Soft-skip any group whose
  // caches haven't all been built yet.
  const fanOut = planMetricFanOut(factMetrics);
  const multiSourceSubGroups = buildMultiSourceSubGroups<ExploratoryPipeline>({
    multiSourceGroups: fanOut.multiSourceGroups,
    metricSourceGroups,
    pipelineByGroupId,
    onMissingPipeline: "skip",
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

    const multiSourceStatsQuery = await startQuery({
      name: `statistics_multi_${queryNameParts}${conversionWindowQueryNameSuffix(subGroup.windowKey)}`,
      displayTitle: `Compute Multi-Source Statistics ${sourceName}`,
      query: integration.getIncrementalRefreshStatisticsQuery({
        settings: snapshotSettings,
        exposureQuery: resolvedExposureQuery,
        activationMetric: activationMetric,
        dimensionsForPrecomputation: [],
        dimensionsForAnalysis: dimensionObjs,
        factTableMap: params.factTableMap,
        unitsSourceTableFullName: unitsTableFullName,
        metrics: subGroup.metrics,
        lastMaxTimestamp: null,
        asOf,
        metricSources: subGroup.pipelines.map((p) => ({
          factTableId: p.group.factTableId,
          tableFullName: p.tableFullName,
          ...(p.covariateTableFullName
            ? { covariateTableFullName: p.covariateTableFullName }
            : {}),
        })),
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
    queries.push(multiSourceStatsQuery);
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

  readonly targetType: QueryRunnerRunTargetType = "experimentSnapshot";

  checkPermissions(): boolean {
    return this.context.permissions.canRunExperimentQueries(
      this.integration.datasource,
    );
  }

  protected override async onHeartbeat(): Promise<void> {
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
      await this.context.models.incrementalRefresh.getLockedBySnapshotId(
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
      {
        ...params,
        asOf: this.model.sourceSnapshotDateCreated,
      },
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
    const wrote = await errorSnapshotIfStillRunning(
      this.context,
      this.model.id,
      {
        queries: this.model.queries,
        error,
      },
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
