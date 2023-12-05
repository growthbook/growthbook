import { getValidDateUTC } from "shared/dates";
import { MetricAnalysis, MetricInterface } from "../../types/metric";
import { Queries, QueryStatus } from "../../types/query";
import { getMetricById, updateMetric } from "../models/MetricModel";
import {
  MetricValueParams,
  MetricValueQueryResponseRows,
  MetricValueResult,
} from "../types/Integration";
import { meanVarianceFromSums } from "../util/stats";
import { QueryRunner, QueryMap } from "./QueryRunner";

export class MetricAnalysisQueryRunner extends QueryRunner<
  MetricInterface,
  MetricValueParams,
  MetricAnalysis
> {
  async startQueries(params: MetricValueParams): Promise<Queries> {
    return [
      await this.startQuery({
        name: "metric",
        query: this.integration.getMetricValueQuery(params),
        dependencies: [],
        run: (query, setExternalId) =>
          this.integration.runMetricValueQuery(query, setExternalId),
        process: (rows) => processMetricValueQueryResponse(rows),
      }),
    ];
  }
  async runAnalysis(queryMap: QueryMap): Promise<MetricAnalysis> {
    const metricData = (queryMap.get("metric")
      ?.result as MetricValueResult) || {
      users: 0,
      count: 0,
      mean: 0,
      stddev: 0,
    };

    let total = (metricData.count || 0) * (metricData.mean || 0);
    let count = metricData.count || 0;
    const dates: { d: Date; v: number; s: number; c: number }[] = [];

    // Calculate total from dates
    if (metricData.dates) {
      total = 0;
      count = 0;

      metricData.dates.forEach((d) => {
        const mean = d.mean;
        const stddev = d.stddev;

        const dateTotal = (d.count || 0) * (d.mean || 0);
        total += dateTotal;
        count += d.count || 0;
        dates.push({
          d: getValidDateUTC(d.date),
          v: mean,
          c: d.count || 0,
          s: stddev,
        });
      });
    }

    const averageBase = count;
    const average = averageBase > 0 ? total / averageBase : 0;

    return {
      createdAt: new Date(),
      average,
      dates,
      segment: this.model.segment || "",
    };
  }
  async getLatestModel(): Promise<MetricInterface> {
    const model = await getMetricById(
      this.model.id,
      this.model.organization,
      true
    );
    if (!model) throw new Error("Could not find metric");
    return model;
  }
  async updateModel({
    queries,
    runStarted,
    result,
    error,
  }: {
    status: QueryStatus;
    queries: Queries;
    runStarted?: Date | undefined;
    result?: MetricAnalysis | undefined;
    error?: string | undefined;
  }): Promise<MetricInterface> {
    const updates: Partial<MetricInterface> = {
      queries,
      ...(runStarted ? { runStarted } : {}),
      ...(result ? { analysis: result } : {}),
      analysisError: result ? "" : error,
    };

    await updateMetric(this.model.id, updates, this.model.organization);

    return {
      ...this.model,
      ...updates,
    };
  }
}

export function processMetricValueQueryResponse(
  rows: MetricValueQueryResponseRows
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
