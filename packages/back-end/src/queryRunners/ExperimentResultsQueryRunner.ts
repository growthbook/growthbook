import { orgHasPremiumFeature } from "enterprise";
import {
  ExperimentMetricInterface,
  isFactMetric,
  isRatioMetric,
} from "shared/experiments";
import chunk from "lodash/chunk";
import {
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotHealth,
  ExperimentSnapshotInterface,
  ExperimentSnapshotSettings,
} from "../../types/experiment-snapshot";
import { MetricInterface } from "../../types/metric";
import { Queries, QueryPointer, QueryStatus } from "../../types/query";
import { SegmentInterface } from "../../types/segment";
import {
  findSnapshotById,
  updateSnapshot,
} from "../models/ExperimentSnapshotModel";
import { findSegmentById } from "../models/SegmentModel";
import { parseDimensionId } from "../services/experiments";
import {
  analyzeExperimentResults,
  analyzeExperimentTraffic,
} from "../services/stats";
import {
  ExperimentAggregateUnitsQueryResponseRows,
  ExperimentDimension,
  ExperimentFactMetricsQueryParams,
  ExperimentMetricQueryParams,
  ExperimentMetricStats,
  ExperimentQueryResponses,
  ExperimentResults,
  ExperimentUnitsQueryParams,
  SourceIntegrationInterface,
} from "../types/Integration";
import { expandDenominatorMetrics } from "../util/sql";
import { getOrganizationById } from "../services/organizations";
import { FactTableMap } from "../models/FactTableModel";
import { OrganizationInterface } from "../../types/organization";
import { FactMetricInterface } from "../../types/fact-table";
import SqlIntegration from "../integrations/SqlIntegration";
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

export const MAX_METRICS_PER_QUERY = 20;

export function getFactMetricGroup(metric: FactMetricInterface) {
  // Ratio metrics must have the same numerator and denominator fact table to be grouped
  if (isRatioMetric(metric)) {
    if (metric.numerator.factTableId !== metric.denominator?.factTableId) {
      return "";
    }
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

    // Skip grouping metrics with percentile caps if there's not an efficient implementation
    if (
      m.capping === "percentile" &&
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
  params: ExperimentResultsQueryParams,
  integration: SourceIntegrationInterface,
  organization: OrganizationInterface,
  startQuery: (
    params: StartQueryParams<RowsType, ProcessedRowsType>
  ) => Promise<QueryPointer>
): Promise<Queries> => {
  const snapshotSettings = params.snapshotSettings;
  const queryParentId = params.queryParentId;
  const metricMap = params.metricMap;

  const org = await getOrganizationById(organization.id);
  const hasPipelineModeFeature = org
    ? orgHasPremiumFeature(org, "pipeline-mode")
    : false;

  const activationMetric = snapshotSettings.activationMetric
    ? metricMap.get(snapshotSettings.activationMetric) ?? null
    : null;

  // Only include metrics tied to this experiment (both goal and guardrail metrics)
  const selectedMetrics = Array.from(
    new Set(
      snapshotSettings.goalMetrics.concat(snapshotSettings.guardrailMetrics)
    )
  )
    .map((m) => metricMap.get(m))
    .filter((m) => m) as ExperimentMetricInterface[];
  if (!selectedMetrics.length) {
    throw new Error("Experiment must have at least 1 metric selected.");
  }

  let segmentObj: SegmentInterface | null = null;
  if (snapshotSettings.segment) {
    segmentObj = await findSegmentById(
      snapshotSettings.segment,
      organization.id
    );
  }

  const exposureQuery = (integration.settings?.queries?.exposure || []).find(
    (q) => q.id === snapshotSettings.exposureQueryId
  );

  const dimensionObj = await parseDimensionId(
    snapshotSettings.dimensions[0]?.id,
    organization.id
  );

  const queries: Queries = [];

  // Settings for units table
  const useUnitsTable =
    (integration.getSourceProperties().supportsWritingTables &&
      integration.settings.pipelineSettings?.allowWriting &&
      !!integration.settings.pipelineSettings?.writeDataset &&
      hasPipelineModeFeature) ??
    false;
  let unitQuery: QueryPointer | null = null;
  const unitsTableFullName =
    useUnitsTable && !!integration.generateTablePath
      ? integration.generateTablePath(
          `growthbook_tmp_units_${queryParentId}`,
          integration.settings.pipelineSettings?.writeDataset,
          "",
          true
        )
      : "";

  // Settings for health query
  const runTrafficQuery = !dimensionObj && org?.settings?.runHealthTrafficQuery;
  let dimensionsForTraffic: ExperimentDimension[] = [];
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
    dimensions: dimensionObj ? [dimensionObj] : dimensionsForTraffic,
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
        "Unable to generate table; table path generator not specified."
      );
    }
    const unitQueryLabels = new Map<string, string>([
      ["query_parent_id", queryParentId],
      ["organization", organization.id],
      ["datasource", integration.datasource],
      ["query_type", "experimentUnits".toLowerCase()],
      ["experiment_id", snapshotSettings.experimentId.toLowerCase()],
    ]);
    unitQuery = await startQuery({
      name: queryParentId,
      query: integration.getExperimentUnitsTableQuery(unitQueryParams),
      dependencies: [],
      labels: unitQueryLabels,
      run: (query, labels, setExternalId) =>
        integration.runExperimentUnitsQuery(query, labels, setExternalId),
      process: (rows) => rows,
      queryType: "experimentUnits",
    });
    queries.push(unitQuery);
  }

  const { groups, singles } = getFactMetricGroups(
    selectedMetrics,
    params.snapshotSettings,
    integration,
    organization
  );

  const singlePromises = singles.map(async (m) => {
    const denominatorMetrics: MetricInterface[] = [];
    if (!isFactMetric(m) && m.denominator) {
      denominatorMetrics.push(
        ...expandDenominatorMetrics(
          m.denominator,
          metricMap as Map<string, MetricInterface>
        )
          .map((m) => metricMap.get(m) as MetricInterface)
          .filter(Boolean)
      );
    }
    const queryParams: ExperimentMetricQueryParams = {
      activationMetric,
      denominatorMetrics,
      dimensions: dimensionObj ? [dimensionObj] : [],
      metric: m,
      segment: segmentObj,
      settings: snapshotSettings,
      useUnitsTable: !!unitQuery,
      unitsTableFullName: unitsTableFullName,
      factTableMap: params.factTableMap,
    };
    const queryLabels = new Map<string, string>([
      ["organization", organization.id],
      ["datasource", integration.datasource],
      ["metric_id", m.id.toLowerCase()],
      ["metric_name", m.name.toLowerCase()],
      ["query_type", "experimentMetric".toLowerCase()],
      ["experiment_id", snapshotSettings.experimentId.toLowerCase()],
    ]);
    queries.push(
      await startQuery({
        name: m.id,
        query: integration.getExperimentMetricQuery(queryParams),
        dependencies: unitQuery ? [unitQuery.query] : [],
        labels: queryLabels,
        run: (query, labels, setExternalId) =>
          integration.runExperimentMetricQuery(query, labels, setExternalId),
        process: (rows) => rows,
        queryType: "experimentMetric",
      })
    );
  });

  const groupPromises = groups.map(async (m, i) => {
    const queryParams: ExperimentFactMetricsQueryParams = {
      activationMetric,
      dimensions: dimensionObj ? [dimensionObj] : [],
      metrics: m,
      segment: segmentObj,
      settings: snapshotSettings,
      useUnitsTable: !!unitQuery,
      unitsTableFullName: unitsTableFullName,
      factTableMap: params.factTableMap,
    };

    if (
      !integration.getExperimentFactMetricsQuery ||
      !integration.runExperimentFactMetricsQuery
    ) {
      throw new Error("Integration does not support multi-metric queries");
    }

    const groupQueryLabels = new Map<string, string>([
      ["organization", organization.id],
      ["datasource", integration.datasource],
      ["query_type", "experimentMultiMetric".toLowerCase()],
      ["experiment_id", snapshotSettings.experimentId.toLowerCase()],
    ]);
    queries.push(
      await startQuery({
        name: `group_${i}`,
        query: integration.getExperimentFactMetricsQuery(queryParams),
        dependencies: unitQuery ? [unitQuery.query] : [],
        labels: groupQueryLabels,
        run: (query, labels, setExternalId) =>
          (integration as SqlIntegration).runExperimentFactMetricsQuery(
            query,
            labels,
            setExternalId
          ),
        process: (rows) => rows,
        queryType: "experimentMultiMetric",
      })
    );
  });

  await Promise.all([...singlePromises, ...groupPromises]);

  if (runTrafficQuery) {
    const trafficQueryLabels = new Map<string, string>([
      ["organization", organization.id],
      ["datasource", integration.datasource],
      ["query_type", "experimentTraffic".toLowerCase()],
      ["experiment_id", snapshotSettings.experimentId.toLowerCase()],
    ]);
    const trafficQuery = await startQuery({
      name: TRAFFIC_QUERY_NAME,
      query: integration.getExperimentAggregateUnitsQuery({
        ...unitQueryParams,
        dimensions: dimensionsForTraffic,
        useUnitsTable: !!unitQuery,
      }),
      dependencies: unitQuery ? [unitQuery.query] : [],
      labels: trafficQueryLabels,
      run: (query, labels, setExternalId) =>
        integration.runExperimentAggregateUnitsQuery(
          query,
          labels,
          setExternalId
        ),
      process: (rows) => rows,
      queryType: "experimentTraffic",
    });
    queries.push(trafficQuery);
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

  async startQueries(params: ExperimentResultsQueryParams): Promise<Queries> {
    this.metricMap = params.metricMap;
    this.variationNames = params.variationNames;
    if (
      this.integration.getSourceProperties().separateExperimentResultQueries
    ) {
      return startExperimentResultQueries(
        params,
        this.integration,
        this.context.org,
        this.startQuery.bind(this)
      );
    } else {
      return this.startLegacyQueries(params);
    }
  }

  async runAnalysis(queryMap: QueryMap): Promise<SnapshotResult> {
    const analysesResults = await analyzeExperimentResults({
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
    await updateSnapshot(this.model.organization, this.model.id, updates);
    return {
      ...this.model,
      ...updates,
    };
  }

  private async startLegacyQueries(
    params: ExperimentResultsQueryParams
  ): Promise<Queries> {
    const snapshotSettings = params.snapshotSettings;
    const metricMap = params.metricMap;

    const activationMetric = snapshotSettings.activationMetric
      ? metricMap.get(snapshotSettings.activationMetric) ?? null
      : null;

    // Only include metrics tied to this experiment (both goal and guardrail metrics)
    const selectedMetrics = Array.from(
      new Set(
        snapshotSettings.goalMetrics.concat(snapshotSettings.guardrailMetrics)
      )
    )
      .map((m) => metricMap.get(m))
      .filter((m) => m) as ExperimentMetricInterface[];
    if (!selectedMetrics.length) {
      throw new Error("Experiment must have at least 1 metric selected.");
    }

    const dimensionObj = await parseDimensionId(
      snapshotSettings.dimensions[0]?.id,
      this.model.organization
    );

    const dimension =
      dimensionObj?.type === "user" ? dimensionObj.dimension : null;
    const query = this.integration.getExperimentResultsQuery(
      snapshotSettings,
      selectedMetrics,
      activationMetric,
      dimension
    );

    const labels = new Map<string, string>([
      ["organization", this.context.org.id],
      ["datasource", this.integration.datasource],
      ["query_type", "experimentResults"],
      ["model_id", this.model.id.toLowerCase()],
      ["experiment_id", this.model.settings.experimentId.toLowerCase()],
    ]);
    return [
      await this.startQuery({
        queryType: "experimentResults",
        name: "results",
        query: query,
        dependencies: [],
        labels: labels,
        run: async () => {
          const rows = (await this.integration.getExperimentResults(
            snapshotSettings,
            selectedMetrics,
            activationMetric,
            dimension
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
    rows: ExperimentQueryResponses
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
