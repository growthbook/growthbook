import {
  expandMetricGroups,
  ExperimentMetricInterface,
  isFactMetric,
} from "shared/experiments";
import { ApiReqContext } from "back-end/types/api";
import { MetricInterface } from "back-end/types/metric";
import { Queries, QueryPointer, QueryStatus } from "back-end/types/query";
import {
  findSnapshotById,
} from "back-end/src/models/ExperimentSnapshotModel";
import {
  Dimension,
  ExperimentFactMetricsQueryParams,
  ExperimentMetricQueryParams,
  SourceIntegrationInterface,
} from "back-end/src/types/Integration";
import { expandDenominatorMetrics } from "back-end/src/util/sql";
import { FactTableMap } from "back-end/src/models/FactTableModel";
import SqlIntegration from "back-end/src/integrations/SqlIntegration";
import {
  QueryRunner,
  QueryMap,
  ProcessedRowsType,
  RowsType,
  StartQueryParams,
} from "./QueryRunner";
import { getFactMetricGroups } from "back-end/src/queryRunners/ExperimentResultsQueryRunner";
import { PopulationDataInterface } from "back-end/types/population-data";
import { ExperimentSnapshotSettings } from "back-end/types/experiment-snapshot";
import { MetricSnapshotSettings } from "back-end/types/report";

// MOVE
export type PopulationDataQuerySettings = Pick<PopulationDataInterface,
 "startDate" | "endDate" | "sourceId" | "sourceType" | "userIdType"
 >;
export interface PopulationDataQueryParams {
  populationSettings: PopulationDataQuerySettings;
  snapshotSettings: ExperimentSnapshotSettings;
  metricMap: Map<string, ExperimentMetricInterface>;
  factTableMap: FactTableMap;
};

export type PopulationDataResult = Pick<PopulationDataInterface, "metrics" | "units">;

export const startPopulationDataQueries = async (
  context: ApiReqContext,
  params: PopulationDataQueryParams,
  integration: SourceIntegrationInterface,
  startQuery: (
    params: StartQueryParams<RowsType, ProcessedRowsType>
  ) => Promise<QueryPointer>
): Promise<Queries> => {
  const settings = params.snapshotSettings
  const metricMap = params.metricMap;

  const { org } = context;

  // Goal metrics only
  const selectedMetrics = settings.goalMetrics.map((m) => metricMap.get(m))
    .filter((m) => m) as ExperimentMetricInterface[];
  if (!selectedMetrics.length) {
    throw new Error("Power must have at least 1 metric selected.");
  }

  // date or week in SQL?
  const dimensionObj: Dimension = {type: "date"}

  const queries: Queries = [];

  const { groups, singles } = getFactMetricGroups(
    selectedMetrics,
    settings,
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
      activationMetric: null,
      denominatorMetrics,
      dimensions: [dimensionObj],
      metric: m,
      segment: null,
      settings,
      unitsSource: "sql",
      factTableMap: params.factTableMap,
    };
    queries.push(
      await startQuery({
        name: m.id,
        query: integration.getExperimentMetricQuery(queryParams),
        dependencies: [],
        run: (query, setExternalId) =>
          integration.runExperimentMetricQuery(query, setExternalId),
        process: (rows) => rows,
        queryType: "populationMetric",
      })
    );
  }

  for (const [i, m] of groups.entries()) {
    const queryParams: ExperimentFactMetricsQueryParams = {
      activationMetric: null,
      dimensions: [dimensionObj],
      metrics: m,
      segment: null,
      settings,
      unitsSource: "sql",
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
        dependencies: [],
        run: (query, setExternalId) =>
          (integration as SqlIntegration).runExperimentFactMetricsQuery(
            query,
            setExternalId
          ),
        process: (rows) => rows,
        queryType: "populationMultiMetric",
      })
    );
  }

  return queries;
};

export class PopulationMetricQueryRunner extends QueryRunner<
  PopulationDataInterface,
  PopulationDataQueryParams,
  PopulationDataResult
> {
  private variationNames: string[] = [];
  private metricMap: Map<string, ExperimentMetricInterface> = new Map();

  checkPermissions(): boolean {
    return this.context.permissions.canRunExperimentQueries(
      this.integration.datasource
    );
  }

  async startQueries(params: PopulationDataQueryParams): Promise<Queries> {
    this.metricMap = params.metricMap;
    return startPopulationDataQueries(
      this.context,
      params,
      this.integration,
      this.startQuery.bind(this)
    );
  }

  async runAnalysis(queryMap: QueryMap): Promise<PopulationDataResult> {
    
  }

  async getLatestModel(): Promise<PopulationDataInterface> {
    // TODO find
    const obj = await findSnapshotById(this.model.organization, this.model.id);
    if (!obj)
      throw new Error("Could not load population model: " + this.model.id);
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
    result?: PopulationDataResult;
    error?: string;
  }): Promise<PopulationDataInterface> {
    const updates: Partial<PopulationDataInterface> = {
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
    // side effects?
    return {
      ...this.model,
      ...updates,
    };
  }
}