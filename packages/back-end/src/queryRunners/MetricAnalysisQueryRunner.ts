import { getValidDateOffsetByUTC } from "shared/dates";
import { MetricAnalysisInterface } from "@back-end/types/metric-analysis";
import { LegacyMetricAnalysis } from "../../types/metric";
import { Queries, QueryStatus } from "../../types/query";
import {
  MetricAnalysisHistogram,
  MetricAnalysisParams,
  MetricAnalysisQueryResponseRows,
  MetricAnalysisResult,
  MetricValueResult,
} from "../types/Integration";
import { meanVarianceFromSums } from "../util/stats";
import { QueryRunner, QueryMap } from "./QueryRunner";

export class MetricAnalysisQueryRunner extends QueryRunner<
  MetricAnalysisInterface,
  MetricAnalysisParams,
  MetricAnalysisResult
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
        process: (rows) => rows,
        queryType: "metricAnalysis",
      }),
    ];
  }
  async runAnalysis(queryMap: QueryMap): Promise<MetricAnalysisResult> {
    const queryResults = queryMap.get("metricAnalysis")?.result as
      | MetricAnalysisQueryResponseRows
      | undefined;
    if (!queryResults) {
      throw new Error("Metric analysis query failed");
    }
    return processMetricAnalysisQueryResponse(queryResults);
  }
  async getLatestModel(): Promise<MetricAnalysisInterface> {
    const model = await this.context.models.metricAnalysis.getById(
      this.model.id
    );
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
    result?: MetricAnalysisResult | undefined;
    error?: string | undefined;
  }): Promise<MetricAnalysisInterface> {
    const updates: Partial<MetricAnalysisInterface> = {
      queries,
      runStarted,
      error,
      result,
      status:
        status === "running"
          ? "running"
          : status === "failed"
          ? "error"
          : "success",
    };

    const latest = await this.getLatestModel();
    const updated = await this.context.models.metricAnalysis.update(
      latest,
      updates
    );
    console.log(updated);
    return updated;
  }
}

export function processMetricAnalysisQueryResponse(
  rows: MetricAnalysisQueryResponseRows
): MetricAnalysisResult {
  const ret: MetricAnalysisResult = { count: 0, mean: 0, stddev: 0 };
  console.log("here");
  console.log(rows);
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
        date: getValidDateOffsetByUTC(date),
        count,
        mean,
        stddev,
      });
    }
    // Overall numbers
    else {
      const histogram: MetricAnalysisHistogram = [...Array(20).keys()].map(
        (i) => {
          return {
            start: row[`bin_width`] * i + row["value_min"],
            end: row[`bin_width`] * (i + 1) + row["value_min"],
            count: row[`count_bin_${i}`] ?? 0,
          };
        }
      );

      ret.count = count;
      ret.mean = mean;
      ret.stddev = stddev;
      ret.histogram = histogram;
    }
  });
  if (ret.dates) {
    ret.dates.sort((a, b) => a.date.getTime() - b.date.getTime());
  }

  return ret;
}
