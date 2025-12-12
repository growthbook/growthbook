import { analyzeExperimentPower } from "shared/enterprise";
import { addDays } from "date-fns";
import {
  ExperimentMetricInterface,
  getAllMetricIdsFromExperiment,
  isFactMetric,
  isLegacyMetric,
  isRatioMetric,
  quantileMetricType,
} from "shared/experiments";
import { FALLBACK_EXPERIMENT_MAX_LENGTH_DAYS } from "shared/constants";
import { daysBetween } from "shared/dates";
import chunk from "lodash/chunk";
import { SegmentInterface } from "shared/types/segment";
import {
  Dimension,
  ExperimentAggregateUnitsQueryResponseRows,
  ExperimentDimensionWithSpecifiedSlices,
  ExperimentFactMetricsQueryParams,
  ExperimentMetricQueryParams,
  ExperimentMetricStats,
  ExperimentQueryResponses,
  ExperimentResults,
  ExperimentUnitsQueryParams,
} from "shared/types/integrations";
import { orgHasPremiumFeature } from "back-end/src/enterprise";
import { ApiReqContext } from "back-end/types/api";
import { ExperimentReportResults } from "back-end/types/report";
import {
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotHealth,
  ExperimentSnapshotInterface,
  ExperimentSnapshotSettings,
  SnapshotType,
} from "back-end/types/experiment-snapshot";
import { MetricInterface } from "back-end/types/metric";
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
import { parseDimension } from "back-end/src/services/experiments";
import {
  analyzeExperimentResults,
  analyzeExperimentTraffic,
} from "back-end/src/services/stats";
import { SourceIntegrationInterface } from "back-end/src/types/Integration";
import { expandDenominatorMetrics } from "back-end/src/util/sql";
import { FactTableMap } from "back-end/src/models/FactTableModel";
import { OrganizationInterface } from "back-end/types/organization";
import { FactMetricInterface } from "back-end/types/fact-table";
import SqlIntegration from "back-end/src/integrations/SqlIntegration";
import { updateReport } from "back-end/src/models/ReportModel";
import { BanditResult } from "back-end/types/experiment";
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
  banditResult?: BanditResult;
  health?: ExperimentSnapshotHealth;
};

export type ExperimentResultsQueryParams = {
  snapshotType: SnapshotType;
  snapshotSettings: ExperimentSnapshotSettings;
  variationNames: string[];
  metricMap: Map<string, ExperimentMetricInterface>;
  factTableMap: FactTableMap;
  queryParentId: string;
  experimentQueryMetadata: ExperimentQueryMetadata | null;
};

export const TRAFFIC_QUERY_NAME = "traffic";

export const UNITS_TABLE_PREFIX = "growthbook_tmp_units";

export const MAX_METRICS_PER_QUERY = 20;

export function getFactMetricGroup(metric: FactMetricInterface) {
  // Ratio metrics must have the same numerator and denominator fact table to be grouped
  if (isRatioMetric(metric)) {
    if (metric.numerator.factTableId !== metric.denominator?.factTableId) {
      // TODO: smarter logic to make fewer groupings work
      const tableIds = [
        metric.numerator.factTableId,
        metric.denominator?.factTableId,
      ].sort((a, b) => a?.localeCompare(b ?? "") ?? 0);
      return tableIds.length >= 2
        ? `${tableIds[0]} ${tableIds[1]} (cross-table ratio metrics)`
        : metric.id;
    }
  }

  // Quantile metrics get their own group to prevent slowing down the main query
  // and because they do not support re-aggregation across pre-computed dimensions
  if (quantileMetricType(metric)) {
    return metric.numerator.factTableId
      ? `${metric.numerator.factTableId}_qtile`
      : "";
  }
  return metric.numerator.factTableId || "";
}

export interface GroupedMetrics {
  // Fact metrics grouped together or alone
  factMetricGroups: FactMetricInterface[][];
  // Legacy metrics always as singletons
  legacyMetricSingles: MetricInterface[];
}

export function getFactMetricGroups(
  metrics: ExperimentMetricInterface[],
  settings: ExperimentSnapshotSettings,
  integration: SourceIntegrationInterface,
  organization: OrganizationInterface,
): GroupedMetrics {
  const legacyMetrics: MetricInterface[] = metrics.filter((m) =>
    isLegacyMetric(m),
  );
  const factMetrics: FactMetricInterface[] = metrics.filter(isFactMetric);

  const defaultReturn: GroupedMetrics = {
    // by default, put all fact metrics in their own group
    factMetricGroups: factMetrics.map((m) => [m]),
    legacyMetricSingles: legacyMetrics,
  };

  // Combining metrics in a single query is an Enterprise-only feature
  if (!orgHasPremiumFeature(organization, "multi-metric-queries")) {
    return defaultReturn;
  }

  // Metrics might have different conversion windows which makes the query complicated
  // TODO(sql): join together metrics with the same date windows for some added efficiency
  if (settings.skipPartialData) {
    return defaultReturn;
  }

  // Org-level setting (in case the multi-metric query introduces bugs)
  // TODO(sql): deprecate this setting and hide it for orgs that have not set it
  if (organization.settings?.disableMultiMetricQueries) {
    return defaultReturn;
  }

  // Group fact metrics into efficient groups (primarily if they share a fact table)
  const groups: Record<string, FactMetricInterface[]> = {};
  factMetrics.forEach((m) => {
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

  // Add unused fact metrics as singles to the group array
  factMetrics.forEach((m) => {
    if (!groupArrays.some((group) => group.includes(m))) {
      groupArrays.push([m]);
    }
  });

  return {
    factMetricGroups: groupArrays,
    legacyMetricSingles: legacyMetrics,
  };
}

export const startExperimentResultQueries = async (
  context: ApiReqContext,
  params: ExperimentResultsQueryParams,
  integration: SourceIntegrationInterface,
  startQuery: (
    params: StartQueryParams<RowsType, ProcessedRowsType>,
  ) => Promise<QueryPointer>,
): Promise<Queries> => {
  const snapshotType = params.snapshotType;
  const snapshotSettings = params.snapshotSettings;
  const queryParentId = params.queryParentId;
  const metricMap = params.metricMap;

  const { org } = context;
  const hasPipelineModeFeature = orgHasPremiumFeature(org, "pipeline-mode");

  const activationMetric = snapshotSettings.activationMetric
    ? (metricMap.get(snapshotSettings.activationMetric) ?? null)
    : null;

  // Only include metrics tied to this experiment (both goal and guardrail metrics)
  const selectedMetrics = snapshotSettings.metricSettings
    .map((m) => metricMap.get(m.id))
    .filter((m) => m) as ExperimentMetricInterface[];
  if (!selectedMetrics.length) {
    throw new Error("Experiment must have at least 1 metric selected.");
  }

  let segmentObj: SegmentInterface | null = null;
  if (snapshotSettings.segment) {
    segmentObj = await context.models.segments.getById(
      snapshotSettings.segment,
    );
  }

  const settings = integration.datasource.settings;

  const exposureQuery = (settings?.queries?.exposure || []).find(
    (q) => q.id === snapshotSettings.exposureQueryId,
  );

  const snapshotDimensions: Dimension[] = (
    await Promise.all(
      snapshotSettings.dimensions.map(
        async (d) => await parseDimension(d.id, d.slices, org.id),
      ),
    )
  ).filter((d): d is Dimension => d !== null);

  const queries: Queries = [];

  // Settings for units table
  const useUnitsTable =
    (integration.getSourceProperties().supportsWritingTables &&
      settings.pipelineSettings?.allowWriting &&
      settings.pipelineSettings?.mode === "ephemeral" &&
      !!settings.pipelineSettings?.writeDataset &&
      hasPipelineModeFeature) ??
    false;
  let unitQuery: QueryPointer | null = null;
  const unitsTableFullName =
    useUnitsTable && !!integration.generateTablePath
      ? integration.generateTablePath(
          `${UNITS_TABLE_PREFIX}_${queryParentId}`,
          settings.pipelineSettings?.writeDataset,
          settings.pipelineSettings?.writeDatabase,
          true,
        )
      : "";

  // Settings for health query
  const runTrafficQuery =
    snapshotType === "standard" && org.settings?.runHealthTrafficQuery;
  let dimensionsForTraffic: ExperimentDimensionWithSpecifiedSlices[] = [];
  if (runTrafficQuery && exposureQuery?.dimensionMetadata) {
    dimensionsForTraffic = exposureQuery.dimensionMetadata
      .filter((dm) => exposureQuery.dimensions.includes(dm.dimension))
      .map((dm) => ({
        type: "experiment",
        id: dm.dimension,
        specifiedSlices: dm.specifiedSlices,
      }));
  }

  const unitQueryParams: ExperimentUnitsQueryParams = {
    activationMetric: activationMetric,
    dimensions: snapshotDimensions.length
      ? snapshotDimensions
      : dimensionsForTraffic,
    segment: segmentObj,
    settings: snapshotSettings,
    unitsTableFullName: unitsTableFullName,
    includeIdJoins: true,
    factTableMap: params.factTableMap,
  };

  if (useUnitsTable) {
    // The Mixpanel integration does not support writing tables
    if (!integration.generateTablePath) {
      throw new Error(
        "Unable to generate table; table path generator not specified.",
      );
    }
    unitQuery = await startQuery({
      name: queryParentId,
      query: integration.getExperimentUnitsTableQuery(unitQueryParams),
      dependencies: [],
      run: (query, setExternalId) =>
        integration.runExperimentUnitsQuery(query, setExternalId),
      process: (rows) => rows,
      queryType: "experimentUnits",
    });
    queries.push(unitQuery);
  }

  const { factMetricGroups, legacyMetricSingles } = getFactMetricGroups(
    selectedMetrics,
    params.snapshotSettings,
    integration,
    org,
  );

  for (const m of legacyMetricSingles) {
    const denominatorMetrics: MetricInterface[] = [];
    if (m.denominator) {
      denominatorMetrics.push(
        ...expandDenominatorMetrics(
          m.denominator,
          metricMap as Map<string, MetricInterface>,
        )
          .map((m) => metricMap.get(m) as MetricInterface)
          .filter(Boolean),
      );
    }
    // Only run overall quantile analysis for standard snapshots
    // regardless of how many dimensions are requested
    const runOverallQuantileAnalysis =
      snapshotType === "standard" && quantileMetricType(m);

    const queryParams: ExperimentMetricQueryParams = {
      activationMetric,
      denominatorMetrics,
      dimensions: runOverallQuantileAnalysis ? [] : snapshotDimensions,
      metric: m,
      segment: segmentObj,
      settings: snapshotSettings,
      unitsSource: unitQuery ? "exposureTable" : "exposureQuery",
      unitsTableFullName: unitsTableFullName,
      factTableMap: params.factTableMap,
    };
    queries.push(
      await startQuery({
        name: m.id,
        query: integration.getExperimentMetricQuery(queryParams),
        dependencies: unitQuery ? [unitQuery.query] : [],
        run: (query, setExternalId) =>
          integration.runExperimentMetricQuery(query, setExternalId),
        process: (rows) => rows,
        queryType: "experimentMetric",
      }),
    );
  }

  for (const [i, m] of factMetricGroups.entries()) {
    // Only run overall quantile analysis for standard snapshots
    // regardless of how many dimensions are requested
    const runOverallQuantileAnalysis =
      snapshotType === "standard" && m.some(quantileMetricType);

    const queryParams: ExperimentFactMetricsQueryParams = {
      activationMetric,
      dimensions: runOverallQuantileAnalysis ? [] : snapshotDimensions,
      metrics: m,
      segment: segmentObj,
      settings: snapshotSettings,
      unitsSource: unitQuery ? "exposureTable" : "exposureQuery",
      unitsTableFullName: unitsTableFullName,
      factTableMap: params.factTableMap,
    };

    if (
      !integration.getExperimentFactMetricsQuery ||
      !integration.runExperimentFactMetricsQuery
    ) {
      throw new Error("Integration does not support multi-metric queries");
    }

    queries.push(
      await startQuery({
        name: `group_${i}`,
        query: integration.getExperimentFactMetricsQuery(queryParams),
        dependencies: unitQuery ? [unitQuery.query] : [],
        run: (query, setExternalId) =>
          (integration as SqlIntegration).runExperimentFactMetricsQuery(
            query,
            setExternalId,
          ),
        process: (rows) => rows,
        queryType: "experimentMultiMetric",
      }),
    );
  }

  // test if precomputed dimensions fails
  let trafficQuery: QueryPointer | null = null;
  if (runTrafficQuery) {
    // the basic traffic query should only use experiment dimensions with specified slices
    // and if there are snapshot dimensions, it should be a subset of those that
    // have specified slices
    const snapshotDimensionsForTraffic: ExperimentDimensionWithSpecifiedSlices[] =
      [];
    snapshotDimensions.forEach((d) => {
      if (d.type === "experiment" && d.specifiedSlices !== undefined) {
        snapshotDimensionsForTraffic.push({
          ...d,
          specifiedSlices: d.specifiedSlices,
        });
      }
    });

    trafficQuery = await startQuery({
      name: TRAFFIC_QUERY_NAME,
      query: integration.getExperimentAggregateUnitsQuery({
        ...unitQueryParams,
        dimensions: snapshotDimensionsForTraffic.length
          ? snapshotDimensionsForTraffic
          : dimensionsForTraffic,
        useUnitsTable: !!unitQuery,
      }),
      dependencies: unitQuery ? [unitQuery.query] : [],
      run: (query, setExternalId) =>
        integration.runExperimentAggregateUnitsQuery(query, setExternalId),
      process: (rows) => rows,
      queryType: "experimentTraffic",
    });
    queries.push(trafficQuery);
  }

  const dropUnitsTable =
    integration.getSourceProperties().dropUnitsTable &&
    settings.pipelineSettings?.unitsTableDeletion;
  if (useUnitsTable && dropUnitsTable) {
    const dropUnitsTableQuery = await startQuery({
      name: `drop_${queryParentId}`,
      query: integration.getDropUnitsTableQuery({
        fullTablePath: unitsTableFullName,
      }),
      dependencies: [],
      // all other queries in model must succeed or fail first
      runAtEnd: true,
      run: (query, setExternalId) =>
        integration.runDropTableQuery(query, setExternalId),
      process: (rows) => rows,
      queryType: "experimentDropUnitsTable",
    });
    queries.push(dropUnitsTableQuery);
  }

  return queries;
};

export class ExperimentResultsQueryRunner extends QueryRunner<
  ExperimentSnapshotInterface,
  ExperimentResultsQueryParams,
  SnapshotResult
> {
  private variationNames: string[] = [];
  private metricMap: Map<string, ExperimentMetricInterface> = new Map();

  checkPermissions(): boolean {
    return this.context.permissions.canRunExperimentQueries(
      this.integration.datasource,
    );
  }

  async startQueries(params: ExperimentResultsQueryParams): Promise<Queries> {
    this.metricMap = params.metricMap;
    this.variationNames = params.variationNames;
    if (params.experimentQueryMetadata) {
      this.integration.setAdditionalQueryMetadata?.(
        params.experimentQueryMetadata,
      );
    }
    if (
      this.integration.getSourceProperties().separateExperimentResultQueries
    ) {
      return startExperimentResultQueries(
        this.context,
        params,
        this.integration,
        this.startQuery.bind(this),
      );
    } else {
      return this.startLegacyQueries(params);
    }
  }

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

    analysesResults.forEach((results: ExperimentReportResults, i: number) => {
      const analysis = this.model.analyses[i];
      if (!analysis) return;

      analysis.results = results.dimensions || [];
      analysis.status = "success";
      analysis.error = "";

      // TODO: do this once, not per analysis
      result.unknownVariations = results.unknownVariations || [];
      result.multipleExposures = results.multipleExposures ?? 0;
    });

    // Run health checks
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

      const relativeAnalysis = this.model.analyses.find(
        (a) => a.settings.differenceType === "relative",
      );

      const isEligibleForMidExperimentPowerAnalysis =
        relativeAnalysis &&
        this.model.settings.banditSettings === undefined &&
        rows &&
        rows.length;

      if (isEligibleForMidExperimentPowerAnalysis) {
        const today = new Date();
        const phaseStartDate = this.model.settings.startDate;
        const experimentMaxLengthDays =
          this.context.org.settings?.experimentMaxLengthDays;

        const experimentTargetEndDate = addDays(
          phaseStartDate,
          experimentMaxLengthDays && experimentMaxLengthDays > 0
            ? experimentMaxLengthDays
            : FALLBACK_EXPERIMENT_MAX_LENGTH_DAYS,
        );
        const targetDaysRemaining = daysBetween(today, experimentTargetEndDate);
        // NB: This does not run a SQL query, but it is a health check that depends on the trafficHealth
        result.health.power = analyzeExperimentPower({
          trafficHealth,
          targetDaysRemaining,
          analysis: relativeAnalysis,
          goalMetrics: this.model.settings.goalMetrics,
          variationsSettings: this.model.settings.variations,
        });
      }
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

  private async startLegacyQueries(
    params: ExperimentResultsQueryParams,
  ): Promise<Queries> {
    const snapshotSettings = params.snapshotSettings;
    const metricMap = params.metricMap;

    const activationMetric = snapshotSettings.activationMetric
      ? (metricMap.get(snapshotSettings.activationMetric) ?? null)
      : null;

    // Only include metrics tied to this experiment (both goal and guardrail metrics)
    const metricGroups = await this.context.models.metricGroups.getAll();
    const selectedMetrics = getAllMetricIdsFromExperiment(
      snapshotSettings,
      false,
      metricGroups,
    )
      .map((m) => metricMap.get(m))
      .filter((m) => m) as ExperimentMetricInterface[];
    if (!selectedMetrics.length) {
      throw new Error("Experiment must have at least 1 metric selected.");
    }

    const dimensionObj = await parseDimension(
      snapshotSettings.dimensions[0]?.id,
      snapshotSettings.dimensions[0]?.slices,
      this.model.organization,
    );

    const dimension =
      dimensionObj?.type === "user" ? dimensionObj.dimension : null;
    const query = this.integration.getExperimentResultsQuery(
      snapshotSettings,
      selectedMetrics,
      activationMetric,
      dimension,
    );

    return [
      await this.startQuery({
        queryType: "experimentResults",
        name: "results",
        query: query,
        dependencies: [],
        run: async () => {
          const rows = (await this.integration.getExperimentResults(
            snapshotSettings,
            selectedMetrics,
            activationMetric,
            dimension,
            // eslint-disable-next-line
          )) as any[];
          return { rows: rows };
        },
        process: (rows: ExperimentQueryResponses) =>
          this.processLegacyExperimentResultsResponse(snapshotSettings, rows),
      }),
    ];
  }

  private processLegacyExperimentResultsResponse(
    snapshotSettings: ExperimentSnapshotSettings,
    rows: ExperimentQueryResponses,
  ): ExperimentResults {
    const ret: ExperimentResults = {
      dimensions: [],
      unknownVariations: [],
    };

    const variationMap = new Map<string, number>();
    snapshotSettings.variations.forEach((v, i) => variationMap.set(v.id, i));

    const unknownVariations: Map<string, number> = new Map();
    let totalUsers = 0;

    const dimensionMap = new Map<string, number>();

    rows.forEach(({ dimension, metrics, users, variation }) => {
      let i = 0;
      if (dimensionMap.has(dimension)) {
        i = dimensionMap.get(dimension) || 0;
      } else {
        i = ret.dimensions.length;
        ret.dimensions.push({
          dimension,
          variations: [],
        });
        dimensionMap.set(dimension, i);
      }

      const numUsers = users || 0;
      totalUsers += numUsers;

      const varIndex = variationMap.get(variation + "");
      if (
        typeof varIndex === "undefined" ||
        varIndex < 0 ||
        varIndex >= snapshotSettings.variations.length
      ) {
        unknownVariations.set(variation, numUsers);
        return;
      }

      const metricData: { [key: string]: ExperimentMetricStats } = {};
      metrics.forEach(({ metric, ...stats }) => {
        metricData[metric] = stats;
      });

      ret.dimensions[i].variations.push({
        variation: varIndex,
        users: numUsers,
        metrics: metricData,
      });
    });

    unknownVariations.forEach((users, variation) => {
      // Ignore unknown variations with an insignificant number of users
      // This protects against random typos causing false positives
      if (totalUsers > 0 && users / totalUsers >= 0.02) {
        ret.unknownVariations.push(variation);
      }
    });

    return ret;
  }
}
