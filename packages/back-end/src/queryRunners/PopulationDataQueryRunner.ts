import {
  ExperimentMetricInterface,
  isBinomialMetric,
  isFactMetric,
  isRatioMetric,
} from "shared/experiments";
import { lastMondayString } from "shared/dates";
import { ApiReqContext } from "back-end/types/api";
import { MetricInterface } from "back-end/types/metric";
import { Queries, QueryPointer, QueryStatus } from "back-end/types/query";
import {
  Dimension,
  ExperimentFactMetricsQueryResponseRows,
  ExperimentMetricQueryResponseRows,
  PopulationFactMetricsQueryParams,
  PopulationMetricQueryParams,
  SourceIntegrationInterface,
} from "back-end/src/types/Integration";
import { expandDenominatorMetrics } from "back-end/src/util/sql";
import { FactTableMap } from "back-end/src/models/FactTableModel";
import SqlIntegration from "back-end/src/integrations/SqlIntegration";
import { getFactMetricGroups } from "back-end/src/queryRunners/ExperimentResultsQueryRunner";
import {
  PopulationDataInterface,
  PopulationDataMetric,
} from "back-end/types/population-data";
import { ExperimentSnapshotSettings } from "back-end/types/experiment-snapshot";
import { SegmentInterface } from "back-end/types/segment";
import {
  QueryRunner,
  QueryMap,
  ProcessedRowsType,
  RowsType,
  StartQueryParams,
} from "./QueryRunner";

export type PopulationDataQuerySettings = Pick<
  PopulationDataInterface,
  "startDate" | "endDate" | "sourceId" | "sourceType" | "userIdType"
>;
export interface PopulationDataQueryParams {
  populationSettings: PopulationDataQuerySettings;
  snapshotSettings: ExperimentSnapshotSettings;
  metricMap: Map<string, ExperimentMetricInterface>;
  factTableMap: FactTableMap;
}

export type PopulationDataResult = Pick<
  PopulationDataInterface,
  "metrics" | "units"
>;

export const startPopulationDataQueries = async (
  context: ApiReqContext,
  params: PopulationDataQueryParams,
  integration: SourceIntegrationInterface,
  startQuery: (
    params: StartQueryParams<RowsType, ProcessedRowsType>
  ) => Promise<QueryPointer>
): Promise<Queries> => {
  const settings = params.snapshotSettings;
  const metricMap = params.metricMap;

  const { org } = context;

  // Goal metrics only
  const selectedMetrics = settings.goalMetrics
    .map((m) => metricMap.get(m))
    .filter((m) => m !== undefined);

  if (!selectedMetrics.length) {
    throw new Error("Power must have at least 1 metric selected.");
  }

  // date or week in SQL?
  const dimensionObj: Dimension = { type: "date" };

  const queries: Queries = [];

  const { groups, singles } = getFactMetricGroups(
    selectedMetrics,
    settings,
    integration,
    org
  );

  let segment: SegmentInterface | null = null;
  if (
    params.populationSettings.sourceType === "segment" &&
    params.populationSettings.sourceId
  ) {
    segment = await context.models.segments.getById(
      params.populationSettings.sourceId
    );
    if (!segment) {
      throw new Error("Segment not found");
    }
  }

  for (const m of singles) {
    if (
      !integration.getPopulationMetricQuery ||
      !integration.runPopulationMetricQuery
    ) {
      throw new Error("Query-based power not supported for this integration.");
    }

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
    const queryParams: PopulationMetricQueryParams = {
      activationMetric: null,
      denominatorMetrics,
      dimensions: [dimensionObj],
      metric: m,
      segment: segment,
      settings,
      unitsSource: "otherQuery",
      factTableMap: params.factTableMap,
      populationSettings: params.populationSettings,
    };

    queries.push(
      await startQuery({
        name: m.id,
        query: integration.getPopulationMetricQuery(queryParams),
        dependencies: [],
        run: (query, setExternalId) =>
          (integration as SqlIntegration).runPopulationMetricQuery(
            query,
            setExternalId
          ),
        process: (rows) => rows,
        queryType: "populationMetric",
      })
    );
  }

  for (const [i, m] of groups.entries()) {
    if (
      !integration.getPopulationFactMetricsQuery ||
      !integration.runPopulationFactMetricsQuery
    ) {
      throw new Error("Integration does not support multi-metric queries");
    }

    const queryParams: PopulationFactMetricsQueryParams = {
      activationMetric: null,
      dimensions: [dimensionObj],
      metrics: m,
      segment: segment,
      settings,
      unitsSource: "otherQuery",
      factTableMap: params.factTableMap,
      populationSettings: params.populationSettings,
    };

    queries.push(
      await startQuery({
        name: `group_${i}`,
        query: integration.getPopulationFactMetricsQuery(queryParams),
        dependencies: [],
        run: (query, setExternalId) =>
          (integration as SqlIntegration).runPopulationFactMetricsQuery(
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

function readMetricData({
  metric,
  rows,
  metricPrefix,
  denominator,
}: {
  metric: ExperimentMetricInterface;
  rows: Record<string, string | number>[];
  metricPrefix?: string;
  denominator?: ExperimentMetricInterface;
}): { metric: PopulationDataMetric; units: PopulationDataResult["units"] } {
  const prefix = metricPrefix ?? "";
  const metricData: PopulationDataMetric = {
    metricId: metric.id,
    type: isBinomialMetric(metric)
      ? "binomial"
      : isRatioMetric(metric, denominator)
      ? "ratio"
      : "mean",
    data: {
      main_sum: rows.reduce(
        (sum, r) => (sum += (r?.[prefix + "main_sum"] as number) ?? 0),
        0
      ),
      main_sum_squares: rows.reduce(
        (sum, r) => (sum += (r?.[prefix + "main_sum_squares"] as number) ?? 0),
        0
      ),
      count: rows.reduce((sum, r) => (sum += (r?.["count"] as number) ?? 0), 0),
      ...(isRatioMetric(metric, denominator)
        ? {
            denominator_sum: rows.reduce(
              (sum, r) =>
                (sum += (r?.[prefix + "denominator_sum"] as number) ?? 0),
              0
            ),
            denominator_sum_squares: rows.reduce(
              (sum, r) =>
                (sum +=
                  (r?.[prefix + "denominator_sum_squares"] as number) ?? 0),
              0
            ),
            main_denominator_sum_product: rows.reduce(
              (sum, r) =>
                (sum +=
                  (r?.[prefix + "main_denominator_sum_product"] as number) ??
                  0),
              0
            ),
          }
        : {}),
    },
  };
  // count units to get max
  const histogram: { [week: string]: number } = {};
  rows.forEach((r) => {
    if (r.dimension) {
      const users = (r.users as number) ?? 0;
      const week = lastMondayString(r.dimension as string);
      if (!histogram[week]) {
        histogram[week] = users;
      }
      histogram[week] += users;
    }
  });

  const units = Object.keys(histogram).map((week) => ({
    week,
    count: histogram[week],
  }));
  return {
    metric: metricData,
    units,
  };
}

export class PopulationDataQueryRunner extends QueryRunner<
  PopulationDataInterface,
  PopulationDataQueryParams,
  PopulationDataResult
> {
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
    const metrics: PopulationDataResult["metrics"] = [];
    let units: PopulationDataResult["units"] = [];
    let allUnitsMax = 0;
    queryMap.forEach((query, key) => {
      // Multi-metric query (refactor with results?)
      if (key.match(/group_/)) {
        const rows = query.result as ExperimentFactMetricsQueryResponseRows;
        if (!rows?.length) return;
        for (let i = 0; i < 100; i++) {
          const prefix = `m${i}_`;
          if (!rows[0]?.[prefix + "id"]) break;

          const metricId = rows[0][prefix + "id"] as string;
          const metric = this.metricMap.get(metricId);
          const denominator =
            metric?.denominator && !isFactMetric(metric)
              ? this.metricMap.get(metric?.denominator)
              : undefined;
          // skip any metrics somehow missing from map
          if (metric) {
            const res = readMetricData({
              metric,
              rows,
              metricPrefix: prefix,
              denominator,
            });
            metrics.push(res.metric);

            const metricUnitsTotal = res.units.reduce(
              (sum, u) => (sum += u.count),
              0
            );
            if (metricUnitsTotal > allUnitsMax) {
              units = res.units;
              allUnitsMax = metricUnitsTotal;
            }
          }
        }
        return;
      }
      // Single metric query, just return rows as-is
      const metric = this.metricMap.get(key);
      if (!metric) return;

      const res = readMetricData({
        metric,
        rows: (query.result ?? []) as ExperimentMetricQueryResponseRows,
      });
      metrics.push(res.metric);

      const metricUnitsTotal = res.units.reduce(
        (sum, u) => (sum += u.count),
        0
      );
      if (metricUnitsTotal > allUnitsMax) {
        units = res.units;
        allUnitsMax = metricUnitsTotal;
      }
    });

    return {
      metrics,
      units,
    };
  }

  async getLatestModel(): Promise<PopulationDataInterface> {
    const model = await this.context.models.populationData.getById(
      this.model.id
    );
    if (!model) {
      throw new Error("Population data not found");
    }
    return model;
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
    const latest = await this.getLatestModel();
    const updated = await this.context.models.populationData.update(
      latest,
      updates
    );
    return updated;
  }
}
