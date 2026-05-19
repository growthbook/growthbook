import {
  ExperimentMetricInterface,
  isFactMetric,
  isRatioMetric,
  isRegressionAdjusted,
} from "shared/experiments";
import { cloneDeep } from "lodash";
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
  CrossFtRatioMetric,
  planMetricFanOut,
} from "back-end/src/services/experimentQueries/planMetricFanOut";
import { SourceIntegrationInterface } from "back-end/src/types/Integration";
import { FactTableMap } from "back-end/src/models/FactTableModel";
import { updateReport } from "back-end/src/models/ReportModel";
import { parseDimension } from "back-end/src/services/experiments";
import { analyzeExperimentResults } from "back-end/src/services/stats";
import { validateIncrementalPipeline } from "back-end/src/services/dataPipeline";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { applyMetricOverrides } from "back-end/src/util/integration";
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

  // Mirror the main runner: same-FT (role "complete") metrics get a stats
  // query against their own cache, then we do a second pass over cross-FT
  // ratio metric pairs and emit one joined stats query per pair (so
  // dimension breakdowns on cross-FT ratios work the same way they do for
  // single-table metrics).
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
    const anyMetricHasCuped = group.metrics.some((m) => {
      const metric = cloneDeep(m);
      applyMetricOverrides(metric, snapshotSettings);
      return (
        snapshotSettings.regressionAdjustmentEnabled &&
        isRegressionAdjusted(metric)
      );
    });

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
        activationMetric: activationMetric,
        // TODO(incremental-refresh): add post-stratification to exploratory
        // analysis. Pre-computation is unused here; we lean on
        // dimensionsForAnalysis to drive breakdowns instead.
        dimensionsForPrecomputation: [],
        dimensionsForAnalysis: dimensionObjs,
        factTableMap: params.factTableMap,
        metricSourceTables: {
          [group.factTableId]: existingSource.tableFullName,
        },
        metricSourceCovariateTables:
          anyMetricHasCuped && existingCovariateSource
            ? { [group.factTableId]: existingCovariateSource.tableFullName }
            : {},
        unitsSourceTableFullName: unitsTableFullName,
        metrics: sameFtMetrics,
        lastMaxTimestamp: existingSource?.maxTimestamp || null,
      }),
      dependencies: [],
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

  // Cross-FT pair pass — mirrors the main runner. We re-derive the
  // numerator/denominator orientation per metric from planMetricFanOut and
  // look up each side's cache from the existing source list. If either
  // side hasn't been built yet (e.g. the user is asking for exploratory
  // analysis before the first cross-FT main run completes), we skip the
  // pair rather than fail — the user will see no exploratory results for
  // those metrics until the main run materializes both caches.
  const fanOut = planMetricFanOut(factMetrics);
  for (const pair of fanOut.crossFtPairs) {
    // Group cross-FT metrics by the unordered pair of cache pipelines they
    // join against. A/B and B/A end up in the same subGroup — the SQL layer
    // is symmetric on source order for cross-FT queries.
    const subGroups = new Map<
      string,
      {
        pipelines: [ExploratoryPipeline, ExploratoryPipeline];
        metrics: CrossFtRatioMetric[];
      }
    >();

    let skippedAny = false;
    for (const crossFt of pair.metrics) {
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
      const numPipeline = numeratorGroup
        ? pipelineByGroupId.get(numeratorGroup.groupId)
        : undefined;
      const denomPipeline = denominatorGroup
        ? pipelineByGroupId.get(denominatorGroup.groupId)
        : undefined;
      if (!numPipeline || !denomPipeline) {
        skippedAny = true;
        continue;
      }
      const sortedPipelines: [ExploratoryPipeline, ExploratoryPipeline] =
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

    if (skippedAny) {
      // Soft-skip is fine for exploratory; the main run will catch up next
      // time it materializes both halves. Logging is left to the caller's
      // standard logger if visibility is needed later.
    }

    for (const subGroup of subGroups.values()) {
      const [pipelineA, pipelineB] = subGroup.pipelines;
      const ftA = params.factTableMap.get(pipelineA.group.factTableId);
      const ftB = params.factTableMap.get(pipelineB.group.factTableId);
      const sourceName = ftA && ftB ? `(${ftA.name} x ${ftB.name})` : "";

      const crossStatsQuery = await startQuery({
        name: `statistics_cross_${pipelineA.group.groupId}__${pipelineB.group.groupId}`,
        displayTitle: `Compute Cross-Fact Statistics ${sourceName}`,
        query: integration.getIncrementalRefreshStatisticsQuery({
          settings: snapshotSettings,
          activationMetric: activationMetric,
          dimensionsForPrecomputation: [],
          dimensionsForAnalysis: dimensionObjs,
          factTableMap: params.factTableMap,
          unitsSourceTableFullName: unitsTableFullName,
          metrics: subGroup.metrics.map((m) => m.metric),
          lastMaxTimestamp: null,
          metricSourceTables: {
            [pipelineA.group.factTableId]: pipelineA.tableFullName,
            [pipelineB.group.factTableId]: pipelineB.tableFullName,
          },
          // Cross-FT CUPED reads each side's covariate cache. Either
          // pipeline may have none (if its metrics aren't RA), and we omit
          // it from the map in that case.
          metricSourceCovariateTables: {
            ...(pipelineA.covariateTableFullName
              ? {
                  [pipelineA.group.factTableId]:
                    pipelineA.covariateTableFullName,
                }
              : {}),
            ...(pipelineB.covariateTableFullName
              ? {
                  [pipelineB.group.factTableId]:
                    pipelineB.covariateTableFullName,
                }
              : {}),
          },
        }),
        dependencies: [],
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

    await validateIncrementalPipeline({
      org: this.context.org,
      integration: this.integration,
      snapshotSettings: params.snapshotSettings,
      metricMap: params.metricMap,
      factTableMap: params.factTableMap,
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
