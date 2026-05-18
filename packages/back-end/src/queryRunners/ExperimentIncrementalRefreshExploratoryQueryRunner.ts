import {
  ExperimentMetricInterface,
  isFactMetric,
  isRegressionAdjusted,
} from "shared/experiments";
import { cloneDeep } from "lodash";
import {
  Dimension,
  IncrementalRefreshStatisticsQueryParams,
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
import {
  getCrossFtPairFactTableIds,
  getCrossFtPairKey,
  getIncrementalRefreshMetricSources,
} from "back-end/src/queryRunners/ExperimentIncrementalRefreshQueryRunner";
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

  const metricSourceGroups = getIncrementalRefreshMetricSources({
    metrics: selectedMetrics.filter((m) => isFactMetric(m)),
    existingMetricSources: existingSources ?? [],
    integration,
    snapshotSettings,
  });

  // Same-FT stats: one query per source, covering only metrics with role "complete".
  for (const group of metricSourceGroups) {
    const existingSource = existingSources?.find(
      (s) => s.groupId === group.groupId,
    );
    if (!existingSource) {
      // skip in case the group just has new metrics (no cache table yet)
      continue;
    }

    const sameFtMetrics = group.metrics
      .filter((e) => e.role === "complete")
      .map((e) => e.metric);

    if (sameFtMetrics.length === 0) {
      // Source only holds cross-FT ratio partial columns; skip for same-FT pass.
      continue;
    }

    const factTable = params.factTableMap.get(group.factTableId);
    const existingCovariateSource = existingCovariateSources?.find(
      (s) => s.groupId === group.groupId,
    );

    const anyMetricHasCuped = sameFtMetrics.some((m) => {
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

    // TODO(incremental-refresh): add metadata about source
    // in case same fact table is split across multiple sources
    const sourceName = factTable ? `(${factTable.name})` : "";

    const metricParams: IncrementalRefreshStatisticsQueryParams = {
      settings: snapshotSettings,
      activationMetric: activationMetric,
      // TODO(incremental-refresh): add post-stratification to exploratory analysis
      // unused in exploratory analysis, use dimensionsForAnalysis instead
      dimensionsForPrecomputation: [],
      dimensionsForAnalysis: dimensionObjs,
      factTableMap: params.factTableMap,
      metricSources: [
        {
          tableFullName: existingSource.tableFullName,
          factTableId: group.factTableId,
        },
      ],
      metricSourceCovariateTableFullName:
        existingCovariateSource?.tableFullName ?? null,
      unitsSourceTableFullName: unitsTableFullName,
      metrics: sameFtMetrics,
      lastMaxTimestamp: existingSource?.maxTimestamp || null,
    };
    const statisticsQuery = await startQuery({
      name: `statistics_${group.groupId}`,
      displayTitle: `Compute Statistics ${sourceName}`,
      query: integration.getIncrementalRefreshStatisticsQuery(metricParams),
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

  // Cross-FT stats: one query per unordered fact-table pair derived from
  // persisted sources. Each cross-FT ratio metric appears in both the
  // numerator-FT source and the denominator-FT source; we join them here.
  type CrossFtPair = {
    factTables: [string, string];
    metrics: FactMetricInterface[];
  };
  const crossFtMetricsByPair = new Map<string, CrossFtPair>();
  selectedMetrics.filter(isFactMetric).forEach((m) => {
    if (!isFactMetric(m)) return;
    const pair = getCrossFtPairFactTableIds(m);
    if (!pair) return;
    const key = getCrossFtPairKey(m) ?? "";
    if (!crossFtMetricsByPair.has(key)) {
      crossFtMetricsByPair.set(key, { factTables: pair, metrics: [] });
    }
    crossFtMetricsByPair.get(key)?.metrics.push(m);
  });

  for (const {
    factTables,
    metrics: crossMetrics,
  } of crossFtMetricsByPair.values()) {
    const [ftA, ftB] = factTables;
    // Find the persisted sources for each FT in the pair.
    const ftASource = existingSources?.find((s) => s.factTableId === ftA);
    const ftBSource = existingSources?.find((s) => s.factTableId === ftB);
    if (!ftASource || !ftBSource) {
      // Cache tables not yet built; skip (can happen if the main run is still in progress).
      continue;
    }

    const ftAFactTable = params.factTableMap.get(ftA);
    const ftBFactTable = params.factTableMap.get(ftB);
    const ftAName = ftAFactTable?.name ?? ftA;
    const ftBName = ftBFactTable?.name ?? ftB;

    const crossMetricParams: IncrementalRefreshStatisticsQueryParams = {
      settings: snapshotSettings,
      activationMetric: activationMetric,
      dimensionsForPrecomputation: [],
      dimensionsForAnalysis: dimensionObjs,
      factTableMap: params.factTableMap,
      metricSources: [
        { tableFullName: ftASource.tableFullName, factTableId: ftA },
        { tableFullName: ftBSource.tableFullName, factTableId: ftB },
      ],
      metricSourceCovariateTableFullName: null,
      unitsSourceTableFullName: unitsTableFullName,
      metrics: crossMetrics,
      lastMaxTimestamp: null,
    };
    const crossStatsQuery = await startQuery({
      name: `statistics_cross_${ftA}_${ftB}`,
      displayTitle: `Compute Cross-Fact Statistics (${ftAName} x ${ftBName})`,
      query:
        integration.getIncrementalRefreshStatisticsQuery(crossMetricParams),
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
