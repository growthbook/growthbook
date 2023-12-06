import { orgHasPremiumFeature } from "enterprise";
import { ExperimentMetricInterface, isFactMetric } from "shared/experiments";
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

export const startExperimentResultQueries = async (
  params: ExperimentResultsQueryParams,
  integration: SourceIntegrationInterface,
  organization: string,
  startQuery: (
    params: StartQueryParams<RowsType, ProcessedRowsType>
  ) => Promise<QueryPointer>
): Promise<Queries> => {
  const snapshotSettings = params.snapshotSettings;
  const queryParentId = params.queryParentId;
  const metricMap = params.metricMap;

  const org = await getOrganizationById(organization);
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
    segmentObj = await findSegmentById(snapshotSettings.segment, organization);
  }

  const exposureQuery = (integration.settings?.queries?.exposure || []).find(
    (q) => q.id === snapshotSettings.exposureQueryId
  );

  const dimensionObj = await parseDimensionId(
    snapshotSettings.dimensions[0]?.id,
    organization
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
    unitQuery = await startQuery({
      name: queryParentId,
      query: integration.getExperimentUnitsTableQuery(unitQueryParams),
      dependencies: [],
      run: (query, setExternalId) =>
        integration.runExperimentUnitsQuery(query, setExternalId),
      process: (rows) => rows,
    });
    queries.push(unitQuery);
  }
  const promises = selectedMetrics.map(async (m) => {
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
    queries.push(
      await startQuery({
        name: m.id,
        query: integration.getExperimentMetricQuery(queryParams),
        dependencies: unitQuery ? [unitQuery.query] : [],
        run: (query, setExternalId) =>
          integration.runExperimentMetricQuery(query, setExternalId),
        process: (rows) => rows,
      })
    );
  });

  await Promise.all(promises);

  if (runTrafficQuery) {
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
        this.model.organization,
        this.startQuery.bind(this)
      );
    } else {
      return this.startLegacyQueries(params);
    }
  }

  async runAnalysis(queryMap: QueryMap): Promise<SnapshotResult> {
    const result: SnapshotResult = {
      analyses: this.model.analyses,
      multipleExposures: 0,
      unknownVariations: [],
    };

    // Run each analysis
    const analysisPromises: Promise<void>[] = [];
    this.model.analyses.forEach((analysis) => {
      analysisPromises.push(
        (async () => {
          const results = await analyzeExperimentResults({
            queryData: queryMap,
            snapshotSettings: this.model.settings,
            analysisSettings: analysis.settings,
            variationNames: this.variationNames,
            metricMap: this.metricMap,
          });

          analysis.results = results.dimensions || [];
          analysis.status = "success";
          analysis.error = "";

          // TODO: do this once, not per analysis
          result.unknownVariations = results.unknownVariations || [];
          result.multipleExposures = results.multipleExposures ?? 0;
        })()
      );
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

    if (analysisPromises.length > 0) {
      await Promise.all(analysisPromises);
    }

    return result;
  }
  async getLatestModel(): Promise<ExperimentSnapshotInterface> {
    const obj = await findSnapshotById(this.model.organization, this.model.id);
    if (!obj) throw new Error("Could not load snapshot model");
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

    return [
      await this.startQuery({
        name: "results",
        query: query,
        dependencies: [],
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
