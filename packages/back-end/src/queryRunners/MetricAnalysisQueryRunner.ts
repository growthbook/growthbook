import { getValidDateOffsetByUTC } from "shared/dates";
import {
  isBinomialMetric,
  isRatioMetric,
  parseSliceMetricId,
  generateSliceStringFromLevels,
  generateSliceString,
  SliceLevelsData,
} from "shared/experiments";
import {
  meanVarianceFromSums,
  proportionVarianceFromSums,
  ratioVarianceFromSums,
  returnZeroIfNotFinite,
} from "shared/util";
import {
  DEFAULT_METRIC_HISTOGRAM_BINS,
  MAX_METRICS_IN_METRIC_ANALYSIS_QUERY,
} from "shared/constants";
import {
  MetricAnalysisParams,
  MetricAnalysisQueryResponseRows,
} from "shared/types/integrations";
import {
  MetricAnalysisHistogram,
  MetricAnalysisInterface,
  MetricAnalysisResult,
} from "shared/types/metric-analysis";
import { FactMetricInterface } from "shared/types/fact-table";
import { Queries, QueryStatus } from "shared/types/query";
import { getMetricWithFiltersApplied } from "../services/metric-analysis";
import { QueryRunner, QueryMap } from "./QueryRunner";

export class MetricAnalysisQueryRunner extends QueryRunner<
  MetricAnalysisInterface,
  MetricAnalysisParams,
  MetricAnalysisResult
> {
  private metrics: FactMetricInterface[] = [];

  checkPermissions(): boolean {
    return this.context.permissions.canRunMetricAnalysisQueries(
      this.integration.datasource,
    );
  }

  // For alternative entrypoints that don't pass the metric in for analysis
  setMetric(metric: FactMetricInterface) {
    this.metrics = [metric];
  }

  private buildMetricsArray(
    metric: FactMetricInterface,
    params: MetricAnalysisParams,
  ): FactMetricInterface[] {
    const { settings } = params;

    // Create metrics with indices - one per slice group if slices are provided, plus the base metric
    const metrics: FactMetricInterface[] = [metric];

    // Get fact table once for reuse
    const factTable = params.factTableMap.get(
      metric.numerator?.factTableId || "",
    );
    if (!factTable) {
      throw new Error("Unknown fact table");
    }

    // 1. Process custom metric slices (if any)
    if (settings.customMetricSlices && settings.customMetricSlices.length > 0) {
      settings.customMetricSlices.forEach((sliceGroup) => {
        // Sort slices alphabetically for consistent ID generation (matching experiment analysis)
        const sortedSlices = sliceGroup.slices.sort((a, b) =>
          a.column.localeCompare(b.column),
        );

        // Build slice levels
        const sliceLevels: SliceLevelsData[] = sortedSlices.map((slice) => {
          const column = factTable.columns.find(
            (col) => col.column === slice.column,
          );
          const datatype =
            column?.datatype === "boolean" ? "boolean" : "string";

          // For boolean "null" slices, use empty array to generate ?dim:col= format
          const levels =
            slice.levels[0] === "null" && datatype === "boolean"
              ? []
              : slice.levels;

          return {
            column: slice.column,
            datatype,
            levels,
          };
        });

        // Generate slice string and create slice metric
        if (sliceLevels.length > 0) {
          const sliceString = generateSliceStringFromLevels(sliceLevels);
          const sliceMetric: FactMetricInterface = {
            ...metric,
            id: `${metric.id}?${sliceString}`,
            name: `${metric.name} (${sortedSlices
              .map((combo) => `${combo.column}: ${combo.levels[0] || ""}`)
              .join(", ")})`,
          };
          metrics.push(sliceMetric);
        }
      });
    }

    // 2. Process auto slices from settings (if any) - separate from custom slices
    if (settings.metricAutoSlices && settings.metricAutoSlices.length > 0) {
      // Find auto slice columns that match the column names in settings.metricAutoSlices
      const autoSliceColumns = factTable.columns.filter(
        (col) =>
          col.isAutoSliceColumn &&
          !col.deleted &&
          (col.autoSlices?.length || 0) > 0 &&
          settings.metricAutoSlices?.includes(col.column),
      );

      autoSliceColumns.forEach((col) => {
        const autoSlices = col.autoSlices || [];

        // Create a metric for each auto slice value
        autoSlices.forEach((value: string) => {
          const sliceString = generateSliceString({
            [col.column]: value,
          });
          const sliceMetric: FactMetricInterface = {
            ...metric,
            id: `${metric.id}?${sliceString}`,
            name: `${metric.name} (${col.name || col.column}: ${value})`,
          };
          metrics.push(sliceMetric);
        });

        // Add "other" slice metric for this auto slice column
        // The "other" slice uses empty value to trigger "other" logic
        const otherSliceString = generateSliceString({
          [col.column]: "", // Empty value triggers "other" logic
        });
        const otherSliceMetric: FactMetricInterface = {
          ...metric,
          id: `${metric.id}?${otherSliceString}`,
          name: `${metric.name} (${col.name || col.column}: other)`,
        };
        metrics.push(otherSliceMetric);
      });
    }

    return metrics;
  }

  async startQueries(params: MetricAnalysisParams): Promise<Queries> {
    const baseMetric = getMetricWithFiltersApplied(params);
    this.metrics = this.buildMetricsArray(baseMetric, params);
    return [
      await this.startQuery({
        name: "metricAnalysis",
        query: this.integration.getMetricAnalysisQuery(this.metrics, params),
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
    if (this.metrics.length === 0) {
      throw new Error("Metrics not available to process query results");
    }
    // Use the base metric (first one) for processing results
    const baseMetric = this.metrics[0];
    return processMetricAnalysisQueryResponse(queryResults, baseMetric);
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

  const dateIndex = new Map<
    number,
    NonNullable<MetricAnalysisResult["dates"]>[0]
  >();

  const getOrCreateDateEntry = (date: Date) => {
    const ts = date.getTime();
    let entry = dateIndex.get(ts);
    if (!entry) {
      entry = {
        date,
        units: 0,
        mean: 0,
      };
      dateIndex.set(ts, entry);
    }
    return entry;
  };

  rows.forEach((row) => {
    const { date, data_type, units } = row;

    for (let i = 0; i < MAX_METRICS_IN_METRIC_ANALYSIS_QUERY; i++) {
      const prefix = `m${i}_`;
      const idKey = `${prefix}id`;
      const metricIdRaw = row[idKey];
      if (!metricIdRaw) {
        // Metrics are contiguous from m0_, so we can stop when we hit the first missing id
        break;
      }

      const metricId = String(metricIdRaw);
      const sliceInfo = parseSliceMetricId(metricId);

      if (sliceInfo.baseMetricId !== metric.id) {
        continue;
      }

      const mainSum = Number(row[`${prefix}main_sum`] ?? 0);
      const mainSumSquares = Number(row[`${prefix}main_sum_squares`] ?? 0);
      const denominatorSumRaw = row[`${prefix}denominator_sum`];
      const denominatorSum =
        denominatorSumRaw === undefined ? undefined : Number(denominatorSumRaw);
      const denominatorSumSquaresRaw = row[`${prefix}denominator_sum_squares`];
      const denominatorSumSquares =
        denominatorSumSquaresRaw === undefined
          ? undefined
          : Number(denominatorSumSquaresRaw);
      const mainDenominatorSumProductRaw =
        row[`${prefix}main_denominator_sum_product`];
      const mainDenominatorSumProduct =
        mainDenominatorSumProductRaw === undefined
          ? undefined
          : Number(mainDenominatorSumProductRaw);

      let mean: number;
      let stddev: number;
      if (isRatioMetric(metric)) {
        const denom = denominatorSum ?? 0;
        mean = denom === 0 ? 0 : mainSum / denom;
        stddev = Math.sqrt(
          ratioVarianceFromSums({
            numerator_sum: mainSum,
            numerator_sum_squares: mainSumSquares,
            denominator_sum: denom,
            denominator_sum_squares: denominatorSumSquares ?? 0,
            numerator_denominator_sum_product: mainDenominatorSumProduct ?? 0,
            n: units,
          }),
        );
      } else if (isBinomialMetric(metric)) {
        mean = units === 0 ? 0 : mainSum / units;
        stddev = mean * Math.sqrt(proportionVarianceFromSums(mainSum, units));
      } else {
        mean = units === 0 ? 0 : mainSum / units;
        stddev = Math.sqrt(
          meanVarianceFromSums(mainSum, mainSumSquares, units),
        );
      }

      // Base metric (no slice) uses overall and per-date series
      if (!sliceInfo.isSliceMetric) {
        if (data_type === "date") {
          if (date) {
            const d = getValidDateOffsetByUTC(date);
            const dateEntry = getOrCreateDateEntry(d);
            dateEntry.units = units;
            dateEntry.mean = returnZeroIfNotFinite(mean);
            dateEntry.stddev = returnZeroIfNotFinite(stddev);
            dateEntry.numerator = mainSum;
            dateEntry.denominator = denominatorSum;
          }
        } else {
          // Overall row (including histogram if present)
          const binWidthRaw = row[`${prefix}bin_width`];
          if (binWidthRaw !== undefined) {
            const binWidth = Number(binWidthRaw) || 0;
            const valueMin = Number(row[`${prefix}value_min`] ?? 0);
            const histogram: MetricAnalysisHistogram = [
              ...Array(DEFAULT_METRIC_HISTOGRAM_BINS).keys(),
            ].map((binIndex) => {
              const unitsBin = Number(
                row[`${prefix}units_bin_${binIndex}`] ?? 0,
              );
              return {
                start: binWidth * binIndex + valueMin,
                end: binWidth * (binIndex + 1) + valueMin,
                units: unitsBin,
              };
            });
            ret.histogram = histogram;
          }

          ret.units = units;
          ret.mean = returnZeroIfNotFinite(mean);
          ret.stddev = returnZeroIfNotFinite(stddev);
          ret.numerator = mainSum;
          ret.denominator = denominatorSum;
        }

        continue;
      }

      if (data_type === "date") {
        if (date) {
          const d = getValidDateOffsetByUTC(date);
          const dateEntry = getOrCreateDateEntry(d);
          if (!dateEntry.slices) {
            dateEntry.slices = [];
          }

          const slice: Record<string, string | null> = {};
          sliceInfo.sliceLevels.forEach((sl) => {
            slice[sl.column] = sl.levels.length ? sl.levels[0] : null;
          });

          dateEntry.slices.push({
            slice,
            units,
            mean: returnZeroIfNotFinite(mean),
            stddev: returnZeroIfNotFinite(stddev),
            numerator: mainSum,
            denominator: denominatorSum,
          });
        }
      }
    }
  });

  if (dateIndex.size > 0) {
    ret.dates = Array.from(dateIndex.values()).sort(
      (a, b) => a.date.getTime() - b.date.getTime(),
    );
  }

  return ret;
}
