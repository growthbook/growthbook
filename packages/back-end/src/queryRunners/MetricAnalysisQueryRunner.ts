import { getValidDateOffsetByUTC } from "shared/dates";
import { isBinomialMetric, isRatioMetric } from "shared/experiments";
import {
  meanVarianceFromSums,
  proportionVarianceFromSums,
  ratioVarianceFromSums,
  returnZeroIfNotFinite,
} from "shared/util";
import { DEFAULT_METRIC_HISTOGRAM_BINS } from "shared/constants";
import {
  MetricAnalysisParams,
  MetricAnalysisQueryResponseRows,
} from "shared/types/integrations";
import {
  MetricAnalysisHistogram,
  MetricAnalysisInterface,
  MetricAnalysisResult,
} from "back-end/types/metric-analysis";
import { FactMetricInterface } from "back-end/types/fact-table";
import { Queries, QueryStatus } from "back-end/types/query";
import { getMetricWithFiltersApplied } from "../services/metric-analysis";
import { QueryRunner, QueryMap } from "./QueryRunner";

export class MetricAnalysisQueryRunner extends QueryRunner<
  MetricAnalysisInterface,
  MetricAnalysisParams,
  MetricAnalysisResult
> {
  private metric?: FactMetricInterface;

  checkPermissions(): boolean {
    return this.context.permissions.canRunMetricAnalysisQueries(
      this.integration.datasource,
    );
  }

  // For alternative entrypoints that don't pass the metric in for analysis
  setMetric(metric: FactMetricInterface) {
    this.metric = metric;
  }

  async startQueries(params: MetricAnalysisParams): Promise<Queries> {
    this.metric = getMetricWithFiltersApplied(params);
    return [
      await this.startQuery({
        name: "metricAnalysis",
        query: this.integration.getMetricAnalysisQuery(this.metric, params),
        dependencies: [],
        run: (query, setExternalId) =>
          this.integration.runMetricAnalysisQuery(query, setExternalId),
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
    if (!this.metric) {
      throw new Error("Metric not available to process query results");
    }
    return processMetricAnalysisQueryResponse(queryResults, this.metric);
  }
  async getLatestModel(): Promise<MetricAnalysisInterface> {
    const model = await this.context.models.metricAnalysis.getById(
      this.model.id,
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
      error,
      result,
      status:
        status === "running"
          ? "running"
          : status === "failed"
            ? "error"
            : "success",
    };
    if (runStarted) {
      updates.runStarted = runStarted;
    }

    const latest = await this.getLatestModel();
    const updated = await this.context.models.metricAnalysis.update(
      latest,
      updates,
    );
    return updated;
  }
}

export function processMetricAnalysisQueryResponse(
  rows: MetricAnalysisQueryResponseRows,
  metric: FactMetricInterface,
): MetricAnalysisResult {
  const ret: MetricAnalysisResult = { units: 0, mean: 0, stddev: 0 };

  rows.forEach((row) => {
    const {
      date,
      data_type,
      units,
      main_sum,
      main_sum_squares,
      denominator_sum,
      denominator_sum_squares,
      main_denominator_sum_product,
    } = row;
    let mean: number;
    let stddev: number;
    if (isRatioMetric(metric)) {
      mean = main_sum / (denominator_sum ?? 0);
      stddev = Math.sqrt(
        ratioVarianceFromSums({
          numerator_sum: main_sum,
          numerator_sum_squares: main_sum_squares,
          denominator_sum: denominator_sum ?? 0,
          denominator_sum_squares: denominator_sum_squares ?? 0,
          numerator_denominator_sum_product: main_denominator_sum_product ?? 0,
          n: units,
        }),
      );
    } else if (isBinomialMetric(metric)) {
      mean = main_sum / units;
      stddev = mean * Math.sqrt(proportionVarianceFromSums(main_sum, units));
    } else {
      mean = main_sum / units;
      stddev = Math.sqrt(
        meanVarianceFromSums(main_sum, main_sum_squares, units),
      );
    }
    // Row for each date
    if (data_type === "date") {
      // remove unmatched dates
      if (date) {
        ret.dates = ret.dates || [];
        ret.dates.push({
          date: getValidDateOffsetByUTC(date),
          units,
          mean: returnZeroIfNotFinite(mean),
          stddev: returnZeroIfNotFinite(stddev),
          numerator: main_sum,
          denominator: denominator_sum,
        });
      }
    }
    // Overall numbers
    else {
      if (row[`bin_width`]) {
        const histogram: MetricAnalysisHistogram = [
          ...Array(DEFAULT_METRIC_HISTOGRAM_BINS).keys(),
        ].map((i) => {
          type RowType = keyof typeof row;
          const bin_width = row[`bin_width`] ?? 0;
          const value_min = row["value_min"] ?? 0;
          const units_bin = row[`units_bin_${i}` as RowType] as number;
          return {
            start: (row[`bin_width`] ?? 0) * i + value_min,
            end: bin_width * (i + 1) + value_min,
            units: units_bin ?? 0,
          };
        });
        ret.histogram = histogram;
      }

      ret.units = units;
      ret.mean = returnZeroIfNotFinite(mean);
      ret.stddev = returnZeroIfNotFinite(stddev);
      ret.numerator = main_sum;
      ret.denominator = denominator_sum;
    }
  });
  if (ret.dates) {
    ret.dates.sort((a, b) => a.date.getTime() - b.date.getTime());
  }

  return ret;
}
