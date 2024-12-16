import { orgHasPremiumFeature } from "enterprise";
import {
  expandMetricGroups,
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
  MetricForSnapshot,
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
  Dimension,
  ExperimentAggregateUnitsQueryResponseRows,
  ExperimentDimension,
  ExperimentFactMetricsQueryParams,
  ExperimentMetricQueryParams,
  ExperimentMetricStats,
  ExperimentQueryResponses,
  ExperimentResults,
  ExperimentUnitsQueryParams,
  SourceIntegrationInterface,
} from "back-end/src/types/Integration";
import { expandDenominatorMetrics } from "back-end/src/util/sql";
import { FactTableMap } from "back-end/src/models/FactTableModel";
import { OrganizationInterface } from "back-end/types/organization";
import { FactMetricInterface } from "back-end/types/fact-table";
import SqlIntegration from "back-end/src/integrations/SqlIntegration";
import { BanditResult } from "back-end/types/stats";
import {
  QueryRunner,
  QueryMap,
  ProcessedRowsType,
  RowsType,
  StartQueryParams,
} from "./QueryRunner";
import { getFactMetricGroups } from "back-end/src/queryRunners/ExperimentResultsQueryRunner";

// MOVE
export interface PopulationMetricQuerySettings {
  metricSettings: MetricForSnapshot[];
    populationType: "segment" | "factTable";
    populationId: string;
  datasourceId: string;
  startDate: Date;
  endDate: Date;
}
export interface PopulationMetricQueryParams {
  settings: PopulationMetricQuerySettings;
  metricMap: Map<string, ExperimentMetricInterface>;
  factTableMap: FactTableMap;
};

export const startExperimentResultQueries = async (
  context: ApiReqContext,
  params: PopulationMetricQueryParams,
  integration: SourceIntegrationInterface,
  startQuery: (
    params: StartQueryParams<RowsType, ProcessedRowsType>
  ) => Promise<QueryPointer>
): Promise<Queries> => {
  const settings = params.settings;
  const metricMap = params.metricMap;

  const { org } = context;

  // Only include metrics tied to this experiment (both goal and guardrail metrics)
  const allMetricGroups = await context.models.metricGroups.getAll();
  const selectedMetrics = expandMetricGroups(
    settings.metricSettings.map((m) => m.id),
    allMetricGroups
  )
    .map((m) => metricMap.get(m))
    .filter((m) => m) as ExperimentMetricInterface[];
  if (!selectedMetrics.length) {
    throw new Error("Experiment must have at least 1 metric selected.");
  }

  const exposureQuery = (settings?.queries?.exposure || []).find(
    (q) => q.id === snapshotSettings.exposureQueryId
  );

  // date or week in SQL?
  const dimensionObj: Dimension = {type: "date"}

  const queries: Queries = [];

  const { groups, singles } = getFactMetricGroups(
    selectedMetrics,
    {skipPartialData: false},
    integration,
    org
  );

  for (const m of singles) {
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
        queryType: "experimentMetric",
      })
    );
  }

  for (const [i, m] of groups.entries()) {
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

    queries.push(
      await startQuery({
        name: `group_${i}`,
        query: integration.getExperimentFactMetricsQuery(queryParams),
        dependencies: unitQuery ? [unitQuery.query] : [],
        run: (query, setExternalId) =>
          (integration as SqlIntegration).runExperimentFactMetricsQuery(
            query,
            setExternalId
          ),
        process: (rows) => rows,
        queryType: "experimentMultiMetric",
      })
    );
  }

  return queries;
};

export class PopulationMetricQueryRunner extends QueryRunner<
  ExperimentSnapshotInterface, //
  PopulationMetricQueryParams,
  SnapshotResult //
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
      return this.startLegacyQueries(params);
    }
  }

  async runAnalysis(queryMap: QueryMap): Promise<SnapshotResult> {
    const {
      results: analysesResults,
      banditResult,
    } = await analyzeExperimentResults({
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
    const selectedMetrics = getAllMetricIdsFromExperiment(
      snapshotSettings,
      false
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
        queryType: "experimentResults",
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
