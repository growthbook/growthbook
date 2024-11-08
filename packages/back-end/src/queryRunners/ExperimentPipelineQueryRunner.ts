import { orgHasPremiumFeature } from "enterprise";
import {
  ExperimentMetricInterface,
  getAllMetricIdsFromExperiment,
  isFactMetric,
  isRatioMetric,
  quantileMetricType,
} from "shared/experiments";
import chunk from "lodash/chunk";
import { ApiReqContext } from "back-end/types/api";
import {
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotHealth,
  ExperimentSnapshotInterface,
  ExperimentSnapshotSettings,
} from "back-end/types/experiment-snapshot";
import { MetricInterface } from "back-end/types/metric";
import { Queries, QueryPointer, QueryStatus } from "back-end/types/query";
import { SegmentInterface } from "back-end/types/segment";
import {
  findSnapshotById,
  updateSnapshot,
} from "back-end/src/models/ExperimentSnapshotModel";
import { parseDimensionId } from "back-end/src/services/experiments";
import {
  analyzeExperimentResults,
  analyzeExperimentTraffic,
} from "back-end/src/services/stats";
import {
  ExperimentAggregateUnitsQueryResponseRows,
  ExperimentDimension,
  ExperimentFactMetricsQueryParams,
  ExperimentMetricQueryParams,
  ExperimentPipelineFactMetricsParams,
  ExperimentPipelineReplaceUnitsTableParams,
  ExperimentUnitsQueryParams,
  SourceIntegrationInterface,
} from "back-end/src/types/Integration";
import { expandDenominatorMetrics } from "back-end/src/util/sql";
import { FactTableMap } from "back-end/src/models/FactTableModel";
import { OrganizationInterface } from "back-end/types/organization";
import { FactMetricInterface } from "back-end/types/fact-table";
import SqlIntegration from "back-end/src/integrations/SqlIntegration";
import {
  QueryRunner,
  QueryMap,
  ProcessedRowsType,
  RowsType,
  StartQueryParams,
} from "./QueryRunner";

export type SnapshotResult = {
  unknownVariations: string[];
  multipleExposures: number;
  analyses: ExperimentSnapshotAnalysis[];
  health?: ExperimentSnapshotHealth;
};

export type ExperimentResultsQueryParams = {
  snapshotSettings: ExperimentSnapshotSettings;
  variationNames: string[];
  metricMap: Map<string, ExperimentMetricInterface>;
  factTableMap: FactTableMap;
  queryParentId: string;
};

export const TRAFFIC_QUERY_NAME = "traffic";

export const UNITS_TABLE_PREFIX = "growthbook_tmp_units";

export const MAX_METRICS_PER_QUERY = 20;

export function getFactMetricGroup(metric: FactMetricInterface) {
  // Ratio metrics must have the same numerator and denominator fact table to be grouped
  if (isRatioMetric(metric)) {
    if (metric.numerator.factTableId !== metric.denominator?.factTableId) {
      return "";
    }
  }

  // Quantile metrics get their own group to prevent slowing down the main query
  if (quantileMetricType(metric)) {
    return metric.numerator.factTableId
      ? `${metric.numerator.factTableId} (quantile metrics)`
      : "";
  }
  return metric.numerator.factTableId || "";
}

export interface GroupedMetrics {
  groups: FactMetricInterface[][];
  singles: ExperimentMetricInterface[];
}

export function getFactMetricGroups(
  metrics: ExperimentMetricInterface[],
  settings: ExperimentSnapshotSettings,
  integration: SourceIntegrationInterface,
  organization: OrganizationInterface
): GroupedMetrics {
  const defaultReturn: GroupedMetrics = {
    groups: [],
    singles: metrics,
  };

  // Metrics might have different conversion windows which makes the query super complicated
  if (settings.skipPartialData) {
    return defaultReturn;
  }
  // Combining metrics in a single query is an Enterprise-only feature
  if (!orgHasPremiumFeature(organization, "multi-metric-queries")) {
    return defaultReturn;
  }

  // Org-level setting (in case the multi-metric query introduces bugs)
  if (organization.settings?.disableMultiMetricQueries) {
    return defaultReturn;
  }

  // Group metrics by fact table id
  const groups: Record<string, FactMetricInterface[]> = {};
  metrics.forEach((m) => {
    // Only fact metrics
    if (!isFactMetric(m)) return;

    // Skip grouping metrics with percentile caps or quantile metrics if there's not an efficient implementation
    if (
      (m.cappingSettings.type === "percentile" || quantileMetricType(m)) &&
      !integration.getSourceProperties().hasEfficientPercentiles
    ) {
      return;
    }

    const group = getFactMetricGroup(m);
    if (group) {
      groups[group] = groups[group] || [];
      groups[group].push(m);
    }
  });

  const groupArrays: FactMetricInterface[][] = [];
  Object.values(groups).forEach((group) => {
    // Split groups into chunks of MAX_METRICS_PER_QUERY
    const chunks = chunk(group, MAX_METRICS_PER_QUERY);
    groupArrays.push(...chunks);
  });

  // Add any metrics that aren't in groupArrays to the singles array
  const singles: ExperimentMetricInterface[] = [];
  metrics.forEach((m) => {
    if (!isFactMetric(m) || !groupArrays.some((group) => group.includes(m))) {
      singles.push(m);
    }
  });

  return {
    groups: groupArrays,
    singles,
  };
}

export const startExperimentResultQueries = async (
  context: ApiReqContext,
  params: ExperimentResultsQueryParams,
  integration: SourceIntegrationInterface,
  startQuery: (
    params: StartQueryParams<RowsType, ProcessedRowsType>
  ) => Promise<QueryPointer>
): Promise<Queries> => {
  const snapshotSettings = params.snapshotSettings;
  const queryParentId = params.queryParentId;
  const metricMap = params.metricMap;

  const { org } = context;
  const hasPipelineModeFeature = orgHasPremiumFeature(org, "pipeline-mode");

  const activationMetric = snapshotSettings.activationMetric
    ? metricMap.get(snapshotSettings.activationMetric) ?? null
    : null;

  // Only include metrics tied to this experiment (both goal and guardrail metrics)
  const selectedMetrics = getAllMetricIdsFromExperiment(snapshotSettings, false)
    .map((m) => metricMap.get(m))
    .filter((m) => m) as ExperimentMetricInterface[];
  if (!selectedMetrics.length) {
    throw new Error("Experiment must have at least 1 metric selected.");
  }

  let segmentObj: SegmentInterface | null = null;
  if (snapshotSettings.segment) {
    segmentObj = await context.models.segments.getById(
      snapshotSettings.segment
    );
  }

  const settings = integration.datasource.settings;

  const exposureQuery = (settings?.queries?.exposure || []).find(
    (q) => q.id === snapshotSettings.exposureQueryId
  );

  const dimensionObj = await parseDimensionId(
    snapshotSettings.dimensions[0]?.id,
    org.id
  );

  const queries: Queries = [];

  // Can run pipeline mode
  const cannotRun = !integration.getSourceProperties().supportsWritingTables ||
      !settings.pipelineSettings?.allowWriting ||
      !settings.pipelineSettings?.writeDataset ||
      !hasPipelineModeFeature;
  if (cannotRun) {
    throw new Error ("Cannot run pipeline mode. Datasource not configured correctly.")
  }
  if (!integration.generateTablePath) {
    throw new Error("Table path generator not specified.");
  }
  const unitsTableFullName = integration.generateTablePath(
      `${UNITS_TABLE_PREFIX}_${queryParentId}`,
      settings.pipelineSettings?.writeDataset,
      settings.pipelineSettings?.writeDatabase,
      true
    );

  // Settings for health query
  let dimensionsForTraffic: ExperimentDimension[] = [];
  if (exposureQuery?.dimensionMetadata) {
    dimensionsForTraffic = exposureQuery.dimensionMetadata
      .filter((dm) => exposureQuery.dimensions.includes(dm.dimension))
      .map((dm) => ({
        type: "experiment",
        id: dm.dimension,
        specifiedSlices: dm.specifiedSlices,
      }));
  }

  // TODO customize lookback date? What altitude is this set at? 
  // What timestamp to use?
  const todayMinusLookback = new Date();
  todayMinusLookback.setHours(todayMinusLookback.getHours() - 2);
  const lookbackDate = todayMinusLookback;

  // 1. Create or replace units table
  const unitQueryParams: ExperimentPipelineReplaceUnitsTableParams = {
    activationMetric: activationMetric,
    dimensions: dimensionObj ? [dimensionObj] : dimensionsForTraffic,
    segment: segmentObj,
    settings: snapshotSettings,
    unitsTableFullName: unitsTableFullName,
    factTableMap: params.factTableMap,
    lookbackDate,
  };
  const unitQuery = await startQuery({
    name: queryParentId,
    query: integration.getExperimentPipelineUnitsQuery(unitQueryParams),
    dependencies: [],
    run: (query, setExternalId) =>
      integration.runExperimentPipelineUnitsQuery(query, setExternalId),
    process: (rows) => rows,
    queryType: "experimentPipelineUnits",
  });
  queries.push(unitQuery);

  const { groups, singles } = getFactMetricGroups(
    selectedMetrics,
    params.snapshotSettings,
    integration,
    org
  );

  // CREATE OR REPLACE METRIC TABLES
  for (const m of singles) {
    console.log(`Skipping query for single metric ${m.id}`);
    // const denominatorMetrics: MetricInterface[] = [];
    // if (!isFactMetric(m) && m.denominator) {
    //   denominatorMetrics.push(
    //     ...expandDenominatorMetrics(
    //       m.denominator,
    //       metricMap as Map<string, MetricInterface>
    //     )
    //       .map((m) => metricMap.get(m) as MetricInterface)
    //       .filter(Boolean)
    //   );
    // }
    // const queryParams: ExperimentMetricQueryParams = {
    //   activationMetric,
    //   denominatorMetrics,
    //   dimensions: dimensionObj ? [dimensionObj] : [],
    //   metric: m,
    //   segment: segmentObj,
    //   settings: snapshotSettings,
    //   useUnitsTable: !!unitQuery,
    //   unitsTableFullName: unitsTableFullName,
    //   factTableMap: params.factTableMap,
    // };
    // queries.push(
    //   await startQuery({
    //     name: m.id,
    //     query: integration.getExperimentMetricQuery(queryParams),
    //     dependencies: unitQuery ? [unitQuery.query] : [],
    //     run: (query, setExternalId) =>
    //       integration.runExperimentMetricQuery(query, setExternalId),
    //     process: (rows) => rows,
    //     queryType: "experimentMetric",
    //   })
    // );
  }

  // TODO MAIN QUESTION HERE
  // Do we want to keep around separate fact tables? makes it easier to re-set
  // one if it needs to be refreshed or you need to add a metric, but
  // seems like more faffing about and more overhead

  // depends on ability to add new columns
  // alter logic needs to be added


  // 2. Update final metric Tables
  const groupMetricQueries = [];
  for (const [i, m] of groups.entries()) {
    const metricTableFullName = integration.generateTablePath(
      `${UNITS_TABLE_PREFIX}_factgroup_${i}_${queryParentId}`,
      settings.pipelineSettings?.writeDataset,
      settings.pipelineSettings?.writeDatabase,
      true
    );

    const queryParams: ExperimentPipelineFactMetricsParams = {
      activationMetric,
      dimensions: dimensionObj ? [dimensionObj] : [],
      metrics: m,
      segment: segmentObj,
      settings: snapshotSettings,
      useUnitsTable: !!unitQuery,
      unitsTableFullName: unitsTableFullName,
      factTableMap: params.factTableMap,
      tableName: metricTableFullName,
      lookbackDate,
    };

    if (
      !integration.runExperimentFactMetricsQuery ||
      !integration.runExperimentFactMetricsQuery
    ) {
      throw new Error("Integration does not support multi-metric queries");
    }

    const groupTrimMetricQuery = await startQuery({
      name: `delete_group_${i}`,
      query: integration.getExperimentPipelineTrimMetricsQuery(queryParams),
      // don't run unless metrics query succeeds
      dependencies: [unitQuery.query],
      run: (query, setExternalId) =>
        integration.runExperimentFactMetricsQuery(
          query,
          setExternalId
        ),
      process: (rows) => rows,
      queryType: "experimentPipelineTrimMetric",
    })
    queries.push(groupTrimMetricQuery);
      
    const groupComputeMetricQuery = await startQuery({
      name: `run_group_${i}`,
      query: integration.getExperimentPipelineFactMetricsQuery(queryParams),
      dependencies: [groupTrimMetricQuery.query],
      run: (query, setExternalId) =>
        integration.runExperimentPipelineFactMetricsQuery(
          query,
          setExternalId
        ),
      process: (rows) => rows,
      queryType: "experimentPipelineMultiMetric",
    });
    queries.push(groupComputeMetricQuery);
  }

  // TODO, join results into one query really wide?
  const trafficQuery = await startQuery({
    name: TRAFFIC_QUERY_NAME,
    query: integration.getExperimentAggregateUnitsQuery({
      ...unitQueryParams,
      dimensions: dimensionsForTraffic,
      useUnitsTable: !!unitQuery,
    }),
    dependencies: unitQuery ? [unitQuery.query] : [],
    run: (query, setExternalId) =>
      integration.runExperimentAggregateUnitsQuery(query, setExternalId),
    process: (rows) => rows,
    queryType: "experimentTraffic",
  });
  queries.push(trafficQuery);

  // TODO delete units table?
  return queries;
};

export class ExperimentPipelineQueryRunner extends QueryRunner<
  ExperimentSnapshotInterface,
  ExperimentResultsQueryParams,
  SnapshotResult
> {
  private variationNames: string[] = [];
  private metricMap: Map<string, ExperimentMetricInterface> = new Map();

  checkPermissions(): boolean {
    return this.context.permissions.canRunExperimentQueries(
      this.integration.datasource
    );
  }

  async startQueries(params: ExperimentResultsQueryParams): Promise<Queries> {
    this.metricMap = params.metricMap;
    this.variationNames = params.variationNames;
    if (
      this.integration.getSourceProperties().separateExperimentResultQueries
    ) {
      return startExperimentResultQueries(
        this.context,
        params,
        this.integration,
        this.startQuery.bind(this)
      );
    } else {
      throw new Error("Pipeline does not support separate queries");
    }
  }

  async runAnalysis(queryMap: QueryMap): Promise<SnapshotResult> {
    const { results } = await analyzeExperimentResults({
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
    };

    results.forEach((result, i) => {
      const analysis = this.model.analyses[i];
      if (!analysis) return;

      analysis.results = result.dimensions || [];
      analysis.status = "success";
      analysis.error = "";

      // TODO: do this once, not per analysis
      result.unknownVariations = result.unknownVariations || [];
      result.multipleExposures = result.multipleExposures ?? 0;
    });

    // Run health checks
    const healthQuery = queryMap.get(TRAFFIC_QUERY_NAME);
    if (healthQuery) {
      const trafficHealth = analyzeExperimentTraffic({
        rows: healthQuery.result as ExperimentAggregateUnitsQueryResponseRows,
        error: healthQuery.error,
        variations: this.model.settings.variations,
      });
      result.health = { traffic: trafficHealth };
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
    runStarted?: Date | undefined;
    result?: SnapshotResult | undefined;
    error?: string | undefined;
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
    return {
      ...this.model,
      ...updates,
    };
  }
}
