import { promisify } from "util";
import os from "os";
import { PythonShell } from "python-shell";
import cloneDeep from "lodash/cloneDeep";
import {
  DEFAULT_P_VALUE_THRESHOLD,
  DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER,
  EXPOSURE_DATE_DIMENSION_NAME,
} from "shared/constants";
import { putBaselineVariationFirst } from "shared/util";
import {
  ExperimentMetricInterface,
  isBinomialMetric,
  isFactMetric,
  isRatioMetric,
  isRegressionAdjusted,
  quantileMetricType,
} from "shared/experiments";
import { hoursBetween } from "shared/dates";
import {
  ExperimentMetricAnalysis,
  MultipleExperimentMetricAnalysis,
} from "../../types/stats";
import {
  ExperimentAggregateUnitsQueryResponseRows,
  ExperimentFactMetricsQueryResponseRows,
  ExperimentMetricQueryResponseRows,
  ExperimentResults,
} from "../types/Integration";
import {
  ExperimentReportResultDimension,
  ExperimentReportResults,
  ExperimentReportVariation,
} from "../../types/report";
import { checkSrm } from "../util/stats";
import { logger } from "../util/logger";
import {
  ExperimentMetricAnalysisParams,
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotSettings,
  ExperimentSnapshotTraffic,
  ExperimentSnapshotTrafficDimension,
  SnapshotSettingsVariation,
} from "../../types/experiment-snapshot";
import { QueryMap } from "../queryRunners/QueryRunner";
import { MAX_ROWS_UNIT_AGGREGATE_QUERY } from "../integrations/SqlIntegration";
import { applyMetricOverrides } from "../util/integration";

// Keep these interfaces in sync with gbstats
export interface AnalysisSettingsForStatsEngine {
  var_names: string[];
  var_ids: string[];
  weights: number[];
  baseline_index: number;
  dimension: string;
  stats_engine: string;
  sequential_testing_enabled: boolean;
  sequential_tuning_parameter: number;
  difference_type: string;
  phase_length_days: number;
  alpha: number;
  max_dimensions: number;
}

export interface MetricSettingsForStatsEngine {
  id: string;
  name: string;
  inverse: boolean;
  statistic_type:
    | "mean"
    | "ratio"
    | "mean_ra"
    | "quantile_event"
    | "quantile_unit";
  main_metric_type: "count" | "binomial" | "quantile";
  denominator_metric_type?: "count" | "binomial" | "quantile";
  covariate_metric_type?: "count" | "binomial" | "quantile";
  quantile_value?: number;
  prior_proper?: boolean;
  prior_mean?: number;
  prior_stddev?: number;
}

export interface QueryResultsForStatsEngine {
  rows:
    | ExperimentMetricQueryResponseRows
    | ExperimentFactMetricsQueryResponseRows;
  metrics: (string | null)[];
  sql?: string;
}

export interface DataForStatsEngine {
  analyses: AnalysisSettingsForStatsEngine[];
  metrics: Record<string, MetricSettingsForStatsEngine>;
  query_results: QueryResultsForStatsEngine[];
}

export interface ExperimentDataForStatsEngine {
  id: string;
  data: DataForStatsEngine;
}

export const MAX_DIMENSIONS = 20;

export function getAvgCPU(pre: os.CpuInfo[], post: os.CpuInfo[]) {
  let user = 0;
  let system = 0;
  let total = 0;

  post.forEach((cpu, i) => {
    const preTimes = pre[i]?.times || { user: 0, sys: 0 };
    const postTimes = cpu.times;

    user += postTimes.user - preTimes.user;
    system += postTimes.sys - preTimes.sys;
    total +=
      Object.values(postTimes).reduce((n, sum) => n + sum, 0) -
      Object.values(preTimes).reduce((n, sum) => n + sum, 0);
  });

  return { user: user / total, system: system / total };
}

export function getAnalysisSettingsForStatsEngine(
  settings: ExperimentSnapshotAnalysisSettings,
  variations: ExperimentReportVariation[],
  coverage: number,
  phaseLengthDays: number
) {
  const sortedVariations = putBaselineVariationFirst(
    variations,
    settings.baselineVariationIndex ?? 0
  );

  const sequentialTestingTuningParameterNumber =
    Number(settings.sequentialTestingTuningParameter) ||
    DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER;
  const pValueThresholdNumber =
    Number(settings.pValueThreshold) || DEFAULT_P_VALUE_THRESHOLD;

  const analysisData: AnalysisSettingsForStatsEngine = {
    var_names: sortedVariations.map((v) => v.name),
    var_ids: sortedVariations.map((v) => v.id),
    weights: sortedVariations.map((v) => v.weight * coverage),
    baseline_index: settings.baselineVariationIndex ?? 0,
    dimension: settings.dimensions[0] || "",
    stats_engine: settings.statsEngine,
    sequential_testing_enabled: settings.sequentialTesting ?? false,
    sequential_tuning_parameter: sequentialTestingTuningParameterNumber,
    difference_type: settings.differenceType,
    phase_length_days: phaseLengthDays,
    alpha: pValueThresholdNumber,
    max_dimensions:
      settings.dimensions[0]?.substring(0, 8) === "pre:date"
        ? 9999
        : MAX_DIMENSIONS,
  };
  return analysisData;
}

async function runStatsEngine(
  statsData: ExperimentDataForStatsEngine[]
): Promise<MultipleExperimentMetricAnalysis[]> {
  const escapedStatsData = JSON.stringify(statsData).replace(/\\/g, "\\\\");
  const start = Date.now();
  const cpus = os.cpus();
  const result = await promisify(PythonShell.runString)(
    `
from gbstats.gbstats import process_multiple_experiment_results
import json
import time

start = time.time()

data = json.loads("""${escapedStatsData}""", strict=False)

results = process_multiple_experiment_results(data)

print(json.dumps({
  'results': results,
  'time': time.time() - start
}, allow_nan=False))`,
    {}
  );

  try {
    const parsed: {
      results: MultipleExperimentMetricAnalysis[];
      time: number;
    } = JSON.parse(result?.[0]);

    logger.debug(`StatsEngine: Python time: ${parsed.time}`);
    logger.debug(
      `StatsEngine: Typescript time: ${(Date.now() - start) / 1000}`
    );
    logger.debug(
      `StatsEngine: Average CPU: ${JSON.stringify(getAvgCPU(cpus, os.cpus()))}`
    );

    return parsed.results;
  } catch (e) {
    logger.error(e, "Failed to run stats model: " + result);
    throw e;
  }
}

function createStatsEngineData(
  params: ExperimentMetricAnalysisParams
): DataForStatsEngine {
  const {
    variations,
    metrics,
    phaseLengthHours,
    coverage,
    analyses,
    queryResults,
  } = params;

  const phaseLengthDays = Number(phaseLengthHours / 24);

  return {
    metrics: metrics,
    query_results: queryResults,
    analyses: analyses.map((a) =>
      getAnalysisSettingsForStatsEngine(
        a,
        variations,
        coverage,
        phaseLengthDays
      )
    ),
  };
}

export async function analyzeSingleExperiment(
  params: ExperimentMetricAnalysisParams
): Promise<ExperimentMetricAnalysis> {
  const result = (
    await runStatsEngine([
      { id: params.id, data: createStatsEngineData(params) },
    ])
  )?.[0];

  if (!result) {
    throw new Error("Error in stats engine: no rows returned");
  }
  if (result.error) {
    logger.error(result.error, "Failed to run stats model: " + result.error);
    throw new Error("Error in stats engine: " + result.error);
  }
  return result.results;
}

export async function analyzeMultipleExperiments(
  params: ExperimentMetricAnalysisParams[]
): Promise<MultipleExperimentMetricAnalysis[]> {
  const result = await runStatsEngine(
    params.map((p) => {
      return { id: p.id, data: createStatsEngineData(p) };
    })
  );

  return result;
}

export function getMetricSettingsForStatsEngine(
  metricDoc: ExperimentMetricInterface,
  metricMap: Map<string, ExperimentMetricInterface>,
  settings: ExperimentSnapshotSettings
): MetricSettingsForStatsEngine {
  const metric = cloneDeep<ExperimentMetricInterface>(metricDoc);
  applyMetricOverrides(metric, settings);

  const denominatorDoc =
    metric.denominator && !isFactMetric(metric)
      ? metricMap.get(metric.denominator)
      : undefined;
  let denominator: undefined | ExperimentMetricInterface = undefined;
  if (denominatorDoc) {
    denominator = cloneDeep<ExperimentMetricInterface>(denominatorDoc);
    applyMetricOverrides(denominator, settings);
  }

  const ratioMetric = isRatioMetric(metric, denominator);
  const quantileMetric = quantileMetricType(metric);
  const regressionAdjusted =
    settings.regressionAdjustmentEnabled &&
    isRegressionAdjusted(metric, denominator);
  const mainMetricType = quantileMetric
    ? "quantile"
    : isBinomialMetric(metric)
    ? "binomial"
    : "count";
  // Fact ratio metrics contain denominator
  if (isFactMetric(metric) && ratioMetric) {
    denominator = metric;
  }

  return {
    id: metric.id,
    name: metric.name,
    inverse: !!metric.inverse,
    statistic_type:
      quantileMetric === "unit"
        ? "quantile_unit"
        : quantileMetric === "event"
        ? "quantile_event"
        : ratioMetric
        ? "ratio"
        : regressionAdjusted
        ? "mean_ra"
        : "mean",
    main_metric_type: mainMetricType,
    ...(denominator && {
      denominator_metric_type: isBinomialMetric(denominator)
        ? "binomial"
        : "count",
    }),
    ...(regressionAdjusted && { covariate_metric_type: mainMetricType }),
    ...(!!quantileMetric && isFactMetric(metric)
      ? { quantile_value: metric.quantileSettings?.quantile ?? 0 }
      : {}),
    prior_proper: metric.priorSettings.proper,
    prior_mean: metric.priorSettings.mean,
    prior_stddev: metric.priorSettings.stddev,
  };
}

export function getMetricsAndQueryDataForStatsEngine(
  queryData: QueryMap,
  metricMap: Map<string, ExperimentMetricInterface>,
  settings: ExperimentSnapshotSettings
) {
  const queryResults: QueryResultsForStatsEngine[] = [];
  const metricSettings: Record<string, MetricSettingsForStatsEngine> = {};
  let unknownVariations: string[] = [];
  // Everything done in a single query (Mixpanel, Google Analytics)
  // Need to convert to the same format as SQL rows
  if (queryData.has("results")) {
    const results = queryData.get("results");
    if (!results) throw new Error("Empty experiment results");
    const data = results.result as ExperimentResults;

    unknownVariations = data.unknownVariations;
    const byMetric: { [key: string]: ExperimentMetricQueryResponseRows } = {};
    data.dimensions.forEach((row) => {
      row.variations.forEach((v) => {
        Object.keys(v.metrics).forEach((metric) => {
          const stats = v.metrics[metric];
          byMetric[metric] = byMetric[metric] || [];
          const metricInterface = metricMap.get(metric);
          if (!metricInterface) {
            return;
          }
          metricSettings[metric] = getMetricSettingsForStatsEngine(
            metricInterface,
            metricMap,
            settings
          );
          byMetric[metric].push({
            dimension: row.dimension,
            variation: settings.variations[v.variation]?.id || v.variation + "",
            users: stats.count,
            count: stats.count,
            main_sum: stats.main_sum,
            main_sum_squares: stats.main_sum_squares,
          });
        });
      });
    });

    Object.keys(byMetric).forEach((metric) => {
      queryResults.push({
        metrics: [metric],
        rows: byMetric[metric],
      });
    });
  }
  // One query for each metric (or group of metrics)
  else {
    queryData.forEach((query, key) => {
      // Multi-metric query
      if (key.match(/group_/)) {
        const rows = query.result as ExperimentFactMetricsQueryResponseRows;
        const metricIds: (string | null)[] = [];
        for (let i = 0; i < 100; i++) {
          const prefix = `m${i}_`;
          if (!rows[0]?.[prefix + "id"]) break;

          const metricId = rows[0][prefix + "id"] as string;

          const metric = metricMap.get(metricId);
          // skip any metrics somehow missing from map
          if (metric) {
            metricIds.push(metricId);
            metricSettings[metricId] = getMetricSettingsForStatsEngine(
              metric,
              metricMap,
              settings
            );
          } else {
            metricIds.push(null);
          }
        }
        queryResults.push({
          metrics: metricIds,
          rows: rows,
          sql: query.query,
        });
        return;
      }

      // Single metric query, just return rows as-is
      const metric = metricMap.get(key);
      if (!metric) return;
      metricSettings[key] = getMetricSettingsForStatsEngine(
        metric,
        metricMap,
        settings
      );
      queryResults.push({
        metrics: [key],
        rows: (query.result ?? []) as ExperimentMetricQueryResponseRows,
        sql: query.query,
      });
    });
  }
  return {
    queryResults,
    metricSettings,
    unknownVariations,
  };
}

export async function analyzeExperimentResults({
  queryData,
  analysisSettings,
  snapshotSettings,
  variationNames,
  metricMap,
}: {
  queryData: QueryMap;
  analysisSettings: ExperimentSnapshotAnalysisSettings[];
  snapshotSettings: ExperimentSnapshotSettings;
  variationNames: string[];
  metricMap: Map<string, ExperimentMetricInterface>;
}): Promise<ExperimentReportResults[]> {
  const mdat = getMetricsAndQueryDataForStatsEngine(
    queryData,
    metricMap,
    snapshotSettings
  );
  const { queryResults, metricSettings } = mdat;
  let { unknownVariations } = mdat;

  const results = await analyzeSingleExperiment({
    id: snapshotSettings.experimentId,
    coverage: snapshotSettings.coverage ?? 1,
    phaseLengthHours: Math.max(
      hoursBetween(snapshotSettings.startDate, snapshotSettings.endDate),
      1
    ),
    variations: snapshotSettings.variations.map((v, i) => ({
      ...v,
      name: variationNames[i] || v.id,
    })),
    analyses: analysisSettings,
    queryResults: queryResults,
    metrics: metricSettings,
  });

  // TODO fix for dimension slices and move to health query
  const multipleExposures = Math.max(
    ...queryResults.map(
      (q) =>
        q.rows.filter((r) => r.variation === "__multiple__")?.[0]?.users || 0
    )
  );

  const ret: ExperimentReportResults[] = [];
  analysisSettings.forEach((_, i) => {
    const dimensionMap: Map<
      string,
      ExperimentReportResultDimension
    > = new Map();

    results.forEach(({ metric, analyses }) => {
      const result = analyses[i];
      if (!result) return;

      unknownVariations = unknownVariations.concat(result.unknownVariations);

      result.dimensions.forEach((row) => {
        const dim = dimensionMap.get(row.dimension) || {
          name: row.dimension,
          srm: 1,
          variations: [],
        };

        row.variations.forEach((v, i) => {
          const data = dim.variations[i] || {
            users: v.users,
            metrics: {},
          };
          data.users = Math.max(data.users, v.users);
          data.metrics[metric] = {
            ...v,
            buckets: [],
          };
          dim.variations[i] = data;
        });

        dimensionMap.set(row.dimension, dim);
      });
    });

    const dimensions = Array.from(dimensionMap.values());
    if (!dimensions.length) {
      dimensions.push({
        name: "All",
        srm: 1,
        variations: [],
      });
    } else {
      dimensions.forEach((dimension) => {
        // Calculate SRM
        dimension.srm = checkSrm(
          dimension.variations.map((v) => v.users),
          snapshotSettings.variations.map((v) => v.weight)
        );
      });
    }

    ret.push({
      multipleExposures,
      unknownVariations: Array.from(new Set(unknownVariations)),
      dimensions,
    });
  });

  return ret;
}
export function analyzeExperimentTraffic({
  rows,
  error,
  variations,
}: {
  rows: ExperimentAggregateUnitsQueryResponseRows;
  error?: string;
  variations: SnapshotSettingsVariation[];
}): ExperimentSnapshotTraffic {
  const overallResult: ExperimentSnapshotTrafficDimension = {
    name: "All",
    srm: 1,
    variationUnits: Array(variations.length).fill(0),
  };
  if (error) {
    return {
      overall: overallResult,
      dimension: {},
      error: error,
    };
  }
  if (!rows || !rows.length) {
    return {
      overall: overallResult,
      dimension: {},
      error: "NO_ROWS_IN_UNIT_QUERY",
    };
  }
  if (rows.length == MAX_ROWS_UNIT_AGGREGATE_QUERY) {
    return {
      overall: overallResult,
      dimension: {},
      error: "TOO_MANY_ROWS",
    };
  }

  // build variation data to check traffic
  const variationIdMap: { [key: string]: number } = {};
  const variationWeights: number[] = [];
  variations.forEach((v, i) => {
    variationIdMap[v.id] = i;
    variationWeights.push(v.weight);
  });

  // use nested objects to easily fill values as we iterate over
  // query result
  const dimTrafficResults: Map<
    string,
    Map<string, ExperimentSnapshotTrafficDimension>
  > = new Map();

  // instantiate return object here, as we can fill `overall`
  // unit data on the first pass
  const trafficResults: ExperimentSnapshotTraffic = {
    overall: overallResult,
    dimension: {},
  };

  rows.forEach((r) => {
    const variationIndex = variationIdMap[r.variation];
    const dimTraffic: Map<string, ExperimentSnapshotTrafficDimension> =
      dimTrafficResults.get(r.dimension_name) ?? new Map();
    const dimValueTraffic: ExperimentSnapshotTrafficDimension = dimTraffic.get(
      r.dimension_value
    ) || {
      name: r.dimension_value,
      srm: 0,
      variationUnits: Array(variations.length).fill(0),
    };
    // assumes one row per dimension slice in the payload, use += if there will be multiple
    dimValueTraffic.variationUnits[variationIndex] = r.units;

    dimTraffic.set(r.dimension_value, dimValueTraffic);
    dimTrafficResults.set(r.dimension_name, dimTraffic);

    // aggregate over date unit counts for overall unit counts
    if (r.dimension_name === EXPOSURE_DATE_DIMENSION_NAME) {
      trafficResults.overall.variationUnits[variationIndex] += r.units;
    }
  });
  trafficResults.overall.srm = checkSrm(
    trafficResults.overall.variationUnits,
    variationWeights
  );
  for (const [dimName, dimTraffic] of dimTrafficResults) {
    for (const dimValueTraffic of dimTraffic.values()) {
      dimValueTraffic.srm = checkSrm(
        dimValueTraffic.variationUnits,
        variationWeights
      );
      if (dimName in trafficResults.dimension) {
        trafficResults.dimension[dimName].push(dimValueTraffic);
      } else {
        trafficResults.dimension[dimName] = [dimValueTraffic];
      }
    }
  }
  return trafficResults;
}
