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
  MetricAnalysisHistogram,
  MetricAnalysisInterface,
  MetricAnalysisResult,
} from "back-end/types/metric-analysis";
import { FactMetricInterface } from "back-end/types/fact-table";
import { Queries, QueryStatus } from "back-end/types/query";
import {
  MetricAnalysisParams,
  MetricAnalysisQueryResponseRows,
} from "back-end/src/types/Integration";
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
        run: (query: string, setExternalId: (id: string) => Promise<void>) =>
          this.integration.runMetricAnalysisQuery(query, setExternalId),
        process: (rows: MetricAnalysisQueryResponseRows) => rows,
        queryType: "metricAnalysis",
      } as Parameters<typeof this.startQuery>[0]),
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

  // Extract slice column names from all rows (check all rows in case first row is missing them)
  const sliceColumnsSet = new Set<string>();
  rows.forEach((row) => {
    Object.keys(row).forEach((key) => {
      // Case-insensitive check for slice columns
      if (key.toLowerCase().startsWith("slice_")) {
        // Normalize to lowercase to handle case variations
        const normalizedKey = key.toLowerCase();
        const columnName = normalizedKey.substring(6); // Remove "slice_" prefix
        sliceColumnsSet.add(columnName);
      }
    });
  });
  const sliceColumns = Array.from(sliceColumnsSet);

  // Group rows by slice combination
  const sliceMap = new Map<string, typeof rows>();
  const overallRows: typeof rows = [];

  rows.forEach((row) => {
    // If we have slice columns defined, treat all rows as slice rows
    // (even if values are NULL, which represents the "overall" slice)
    if (sliceColumns.length > 0) {
      // Extract slice values for this row
      const sliceValues: Record<string, string | null> = {};
      sliceColumns.forEach((col) => {
        // Find the actual key in the row (might be different case)
        // We normalized col to lowercase, but the actual key might be different
        const actualKey = Object.keys(row).find(
          (k) => k.toLowerCase() === `slice_${col.toLowerCase()}`,
        );
        const value = actualKey
          ? (row[actualKey as keyof typeof row] as string | null | undefined)
          : undefined;
        sliceValues[col] = value === undefined ? null : value;
      });

      // Create a key for this slice combination
      // Include all slice columns, even if NULL (NULL represents "overall" for that dimension)
      const sliceKey = JSON.stringify(
        Object.entries(sliceValues)
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([k, v]) => [k, v === null ? "__NULL__" : v]),
      );

      if (!sliceMap.has(sliceKey)) {
        sliceMap.set(sliceKey, []);
      }
      sliceMap.get(sliceKey)!.push(row);
    } else {
      // No slice columns, treat as overall rows
      overallRows.push(row);
    }
  });

  // Process overall rows (no slices)
  overallRows.forEach((row) => {
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

  // Process slice rows
  if (sliceMap.size > 0) {
    ret.slices = [];

    // Aggregate data for overall dates (across all slices)
    const overallDatesMap = new Map<
      string,
      {
        date: Date;
        units: number;
        main_sum: number;
        main_sum_squares: number;
        denominator_sum: number;
        denominator_sum_squares: number;
        main_denominator_sum_product: number;
      }
    >();

    // Track overall stats (aggregated across all slices)
    let overallUnits = 0;
    let overallMainSum = 0;
    let overallMainSumSquares = 0;
    let overallDenominatorSum = 0;
    let overallDenominatorSumSquares = 0;
    let overallMainDenominatorSumProduct = 0;
    let overallHistogram: MetricAnalysisHistogram | undefined;

    sliceMap.forEach((sliceRows, sliceKey) => {
      const sliceData = JSON.parse(sliceKey) as Array<[string, string]>;
      const slice: Record<string, string | null> = {};
      sliceData.forEach(([col, val]) => {
        // Convert "__NULL__" back to null
        slice[col] = val === "__NULL__" ? null : val;
      });

      const sliceResult: NonNullable<MetricAnalysisResult["slices"]>[0] = {
        slice,
        units: 0,
        mean: 0,
        stddev: 0,
        dates: [],
      };

      sliceRows.forEach((row) => {
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
              numerator_denominator_sum_product:
                main_denominator_sum_product ?? 0,
              n: units,
            }),
          );
        } else if (isBinomialMetric(metric)) {
          mean = main_sum / units;
          stddev =
            mean * Math.sqrt(proportionVarianceFromSums(main_sum, units));
        } else {
          mean = main_sum / units;
          stddev = Math.sqrt(
            meanVarianceFromSums(main_sum, main_sum_squares, units),
          );
        }

        if (data_type === "date") {
          if (date) {
            const dateObj = getValidDateOffsetByUTC(date);
            const dateKey = dateObj.toISOString();

            // Add to slice dates
            sliceResult.dates = sliceResult.dates || [];
            sliceResult.dates.push({
              date: dateObj,
              units,
              mean: returnZeroIfNotFinite(mean),
              stddev: returnZeroIfNotFinite(stddev),
              numerator: main_sum,
              denominator: denominator_sum,
            });

            // Aggregate for overall dates (sum across all slices for each date)
            const existing = overallDatesMap.get(dateKey);
            if (existing) {
              existing.units += units;
              existing.main_sum += main_sum;
              existing.main_sum_squares += main_sum_squares;
              existing.denominator_sum += denominator_sum ?? 0;
              existing.denominator_sum_squares += denominator_sum_squares ?? 0;
              existing.main_denominator_sum_product +=
                main_denominator_sum_product ?? 0;
            } else {
              overallDatesMap.set(dateKey, {
                date: dateObj,
                units,
                main_sum,
                main_sum_squares,
                denominator_sum: denominator_sum ?? 0,
                denominator_sum_squares: denominator_sum_squares ?? 0,
                main_denominator_sum_product: main_denominator_sum_product ?? 0,
              });
            }
          }
        } else {
          // Aggregate overall stats (sum across all slices)
          overallUnits += units;
          overallMainSum += main_sum;
          overallMainSumSquares += main_sum_squares;
          overallDenominatorSum += denominator_sum ?? 0;
          overallDenominatorSumSquares += denominator_sum_squares ?? 0;
          overallMainDenominatorSumProduct += main_denominator_sum_product ?? 0;

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
            sliceResult.histogram = histogram;
            // For overall histogram, we'd need to aggregate bins across slices
            // For now, use the first slice's histogram (or we could sum them)
            if (!overallHistogram) {
              overallHistogram = histogram;
            }
          }

          sliceResult.units = units;
          sliceResult.mean = returnZeroIfNotFinite(mean);
          sliceResult.stddev = returnZeroIfNotFinite(stddev);
          sliceResult.numerator = main_sum;
          sliceResult.denominator = denominator_sum;
        }
      });

      if (sliceResult.dates) {
        sliceResult.dates.sort(
          (a: { date: Date }, b: { date: Date }) =>
            a.date.getTime() - b.date.getTime(),
        );
      }

      ret.slices!.push(sliceResult);
    });

    // Create overall dates from aggregated slice data
    if (overallDatesMap.size > 0) {
      ret.dates = [];
      overallDatesMap.forEach((agg) => {
        let mean: number;
        let stddev: number;
        if (isRatioMetric(metric)) {
          mean = agg.main_sum / (agg.denominator_sum || 1);
          stddev = Math.sqrt(
            ratioVarianceFromSums({
              numerator_sum: agg.main_sum,
              numerator_sum_squares: agg.main_sum_squares,
              denominator_sum: agg.denominator_sum,
              denominator_sum_squares: agg.denominator_sum_squares,
              numerator_denominator_sum_product:
                agg.main_denominator_sum_product,
              n: agg.units,
            }),
          );
        } else if (isBinomialMetric(metric)) {
          mean = agg.main_sum / agg.units;
          stddev =
            mean *
            Math.sqrt(proportionVarianceFromSums(agg.main_sum, agg.units));
        } else {
          mean = agg.main_sum / agg.units;
          stddev = Math.sqrt(
            meanVarianceFromSums(agg.main_sum, agg.main_sum_squares, agg.units),
          );
        }

        ret.dates!.push({
          date: agg.date,
          units: agg.units,
          mean: returnZeroIfNotFinite(mean),
          stddev: returnZeroIfNotFinite(stddev),
          numerator: agg.main_sum,
          denominator: agg.denominator_sum,
        });
      });
    }

    // Set overall stats from aggregated slice data
    if (overallUnits > 0) {
      let overallMean: number;
      let overallStddev: number;
      if (isRatioMetric(metric)) {
        overallMean = overallMainSum / (overallDenominatorSum || 1);
        overallStddev = Math.sqrt(
          ratioVarianceFromSums({
            numerator_sum: overallMainSum,
            numerator_sum_squares: overallMainSumSquares,
            denominator_sum: overallDenominatorSum,
            denominator_sum_squares: overallDenominatorSumSquares,
            numerator_denominator_sum_product: overallMainDenominatorSumProduct,
            n: overallUnits,
          }),
        );
      } else if (isBinomialMetric(metric)) {
        overallMean = overallMainSum / overallUnits;
        overallStddev =
          overallMean *
          Math.sqrt(proportionVarianceFromSums(overallMainSum, overallUnits));
      } else {
        overallMean = overallMainSum / overallUnits;
        overallStddev = Math.sqrt(
          meanVarianceFromSums(
            overallMainSum,
            overallMainSumSquares,
            overallUnits,
          ),
        );
      }

      ret.units = overallUnits;
      ret.mean = returnZeroIfNotFinite(overallMean);
      ret.stddev = returnZeroIfNotFinite(overallStddev);
      ret.numerator = overallMainSum;
      ret.denominator = overallDenominatorSum;

      if (overallHistogram) {
        ret.histogram = overallHistogram;
      }
    }
  }

  if (ret.dates) {
    ret.dates.sort((a, b) => a.date.getTime() - b.date.getTime());
  }

  return ret;
}
