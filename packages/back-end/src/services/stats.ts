import { promisify } from "util";
import os from "os";
import { PythonShell } from "python-shell";
import {
  DEFAULT_P_VALUE_THRESHOLD,
  DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER,
  EXPOSURE_DATE_DIMENSION_NAME,
} from "shared/constants";
import { putBaselineVariationFirst } from "shared/util";
import { ExperimentMetricInterface } from "shared/experiments";
import { hoursBetween } from "shared/dates";
import { ExperimentMetricAnalysis } from "../../types/stats";
import {
  ExperimentAggregateUnitsQueryResponseRows,
  ExperimentMetricQueryResponseRows,
  ExperimentResults,
} from "../types/Integration";
import {
  ExperimentReportResultDimension,
  ExperimentReportResults,
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

// These same type definitions exist in gbstats.py
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
export interface MetricDataForStatsEngine {
  metric: string;
  rows: ExperimentMetricQueryResponseRows;
  inverse: boolean;
  multiple_exposures: number;
}
export interface DataForStatsEngine {
  analyses: AnalysisSettingsForStatsEngine[];
  metrics: MetricDataForStatsEngine[];
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

export async function analyzeExperimentMetric(
  params: ExperimentMetricAnalysisParams
): Promise<ExperimentMetricAnalysis> {
  const { variations, metrics, phaseLengthHours, coverage, analyses } = params;

  const phaseLengthDays = Number(phaseLengthHours / 24);

  function isMetricData(
    data: MetricDataForStatsEngine | null
  ): data is MetricDataForStatsEngine {
    return !!data;
  }

  const metricData: MetricDataForStatsEngine[] = metrics
    .map((m): MetricDataForStatsEngine | null => {
      if (!m) return null;

      const { metric, rows } = m;

      const data: MetricDataForStatsEngine = {
        metric: metric.id,
        rows,
        inverse: !!metric.inverse,
        multiple_exposures:
          rows.filter((r) => r.variation === "__multiple__")?.[0]?.users || 0,
      };
      return data;
    })
    .filter(isMetricData);
  const statsData: DataForStatsEngine = {
    metrics: metricData,
    analyses: analyses.map(
      ({
        dimensions,
        baselineVariationIndex,
        differenceType,
        statsEngine,
        sequentialTesting,
        sequentialTestingTuningParameter,
        pValueThreshold,
      }) => {
        const sortedVariations = putBaselineVariationFirst(
          variations,
          baselineVariationIndex ?? 0
        );

        const sequentialTestingTuningParameterNumber =
          Number(sequentialTestingTuningParameter) ||
          DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER;
        const pValueThresholdNumber =
          Number(pValueThreshold) || DEFAULT_P_VALUE_THRESHOLD;

        const analysisData: AnalysisSettingsForStatsEngine = {
          var_names: sortedVariations.map((v) => v.name),
          var_ids: sortedVariations.map((v) => v.id),
          weights: sortedVariations.map((v) => v.weight * coverage),
          baseline_index: baselineVariationIndex ?? 0,
          dimension: dimensions[0] || "",
          stats_engine: statsEngine,
          sequential_testing_enabled: sequentialTesting ?? false,
          sequential_tuning_parameter: sequentialTestingTuningParameterNumber,
          difference_type: differenceType,
          phase_length_days: phaseLengthDays,
          alpha: pValueThresholdNumber,
          max_dimensions:
            dimensions[0]?.substring(0, 8) === "pre:date"
              ? 9999
              : MAX_DIMENSIONS,
        };
        return analysisData;
      }
    ),
  };

  const escapedStatsData = JSON.stringify(statsData).replace(/\\/g, "\\\\");

  const start = Date.now();
  const cpus = os.cpus();
  const result = await promisify(PythonShell.runString)(
    `
from gbstats.gbstats import process_experiment_results
import json
import time

start = time.time()

data = json.loads("""${escapedStatsData}""", strict=False)

results = process_experiment_results(data)

print(json.dumps({
  'results': results,
  'time': time.time() - start
}, allow_nan=False))`,
    {}
  );

  try {
    const parsed: {
      results: ExperimentMetricAnalysis;
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
  const metricRows: {
    metric: string;
    rows: ExperimentMetricQueryResponseRows;
  }[] = [];

  let unknownVariations: string[] = [];
  let multipleExposures = 0;

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
          byMetric[metric].push({
            dimension: row.dimension,
            variation:
              snapshotSettings.variations[v.variation]?.id || v.variation + "",
            users: stats.count,
            count: stats.count,
            statistic_type: "mean", // no ratio in mixpanel or GA
            main_metric_type: stats.metric_type,
            main_sum: stats.main_sum,
            main_sum_squares: stats.main_sum_squares,
          });
        });
      });
    });

    Object.keys(byMetric).forEach((metric) => {
      metricRows.push({
        metric,
        rows: byMetric[metric],
      });
    });
  }
  // One query for each metric, can just use the rows directly from the query
  else {
    queryData.forEach((query, key) => {
      const metric = metricMap.get(key);
      if (!metric) return;

      metricRows.push({
        metric: key,
        rows: query.result as ExperimentMetricQueryResponseRows,
      });
    });
  }

  const results = await analyzeExperimentMetric({
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
    metrics: metricRows.map((data) => {
      const metric = metricMap.get(data.metric);
      if (!metric) return null;
      return {
        metric,
        rows: data.rows,
      };
    }),
  });

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
      multipleExposures = Math.max(multipleExposures, result.multipleExposures);

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
