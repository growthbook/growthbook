import { MetricAnalysisInterface } from "@back-end/types/metric-analysis";
import { LegacyMetricAnalysis } from "../../types/metric";
import { Queries, QueryStatus } from "../../types/query";
import {
  MetricAnalysisParams,
  MetricAnalysisQueryResponseRows,
  MetricValueResult,
} from "../types/Integration";
import { meanVarianceFromSums } from "../util/stats";
import { QueryRunner, QueryMap } from "./QueryRunner";

export class MetricAnalysisQueryRunner extends QueryRunner<
  MetricAnalysisInterface,
  MetricAnalysisParams,
  LegacyMetricAnalysis
> {
  checkPermissions(): boolean {
    return this.context.permissions.canRunMetricQueries(
      this.integration.datasource
    );
  }

  async startQueries(params: MetricAnalysisParams): Promise<Queries> {
    return [
      await this.startQuery({
        name: "metricAnalysis",
        query: this.integration.getMetricAnalysisQuery(params),
        dependencies: [],
        run: (query, setExternalId) =>
          this.integration.runMetricAnalysisQuery(query, setExternalId),
        process: (rows) => processMetricAnalysisQueryResponse(rows),
        queryType: "metricAnalysis",
      }),
    ];
  }
  async runAnalysis(queryMap: QueryMap): Promise<LegacyMetricAnalysis> {
    console.log(queryMap);
    throw new Error("runAnalysis");
  }
  async getLatestModel(): Promise<MetricAnalysisInterface> {
    const model = await this.context.models.metricAnalysis.getById(this.model.id);
    if (!model) {
      throw new Error("Metric analysis not found");
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
    runStarted?: Date | undefined;
    result?: LegacyMetricAnalysis | undefined;
    error?: string | undefined;
  }): Promise<MetricAnalysisInterface> {
    const updates: Partial<MetricAnalysisInterface> = {
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
    }

    const latest = await this.getLatestModel();
    const updated = await this.context.models.metricAnalysis.update(
      latest,
      updates
    );
    console.log(updated)
    return updated
  }
}

export function processMetricAnalysisQueryResponse(
  rows: MetricAnalysisQueryResponseRows
): MetricValueResult {
  const ret: MetricValueResult = { count: 0, mean: 0, stddev: 0 };

  rows.forEach((row) => {
    const { date, count, main_sum, main_sum_squares } = row;
    const mean = main_sum / count;
    const stddev = Math.sqrt(
      meanVarianceFromSums(main_sum, main_sum_squares, count)
    );
    // Row for each date
    if (date) {
      ret.dates = ret.dates || [];
      ret.dates.push({
        date,
        count,
        mean,
        stddev,
      });
    }
    // Overall numbers
    else {
      ret.count = count;
      ret.mean = mean;
      ret.stddev = stddev;
    }
  });

  return ret;
}
