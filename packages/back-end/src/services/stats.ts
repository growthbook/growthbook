import cloneDeep from "lodash/cloneDeep";
import {
  BANDIT_SRM_DIMENSION_NAME,
  DEFAULT_P_VALUE_THRESHOLD,
  DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER,
  DEFAULT_TARGET_MDE,
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
import chunk from "lodash/chunk";
import {
  ExperimentAggregateUnitsQueryResponseRows,
  ExperimentFactMetricsQueryResponseRows,
  ExperimentMetricQueryResponseRows,
  ExperimentResults,
} from "shared/types/integrations";
import {
  AnalysisSettingsForStatsEngine,
  BanditSettingsForStatsEngine,
  BusinessMetricTypeForStatsEngine,
  DataForStatsEngine,
  ExperimentDataForStatsEngine,
  ExperimentMetricAnalysis,
  MetricSettingsForStatsEngine,
  MultipleExperimentMetricAnalysis,
  QueryResultsForStatsEngine,
} from "back-end/types/stats";
import {
  ExperimentReportResultDimension,
  ExperimentReportResults,
  ExperimentReportVariation,
} from "back-end/types/report";
import { checkSrm, chi2pvalue } from "back-end/src/util/stats";
import { promiseAllChunks } from "back-end/src/util/promise";
import { logger } from "back-end/src/util/logger";
import {
  ExperimentAnalysisParamsContextData,
  ExperimentMetricAnalysisParams,
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotSettings,
  ExperimentSnapshotTraffic,
  ExperimentSnapshotTrafficDimension,
  SnapshotBanditSettings,
  SnapshotSettingsVariation,
} from "back-end/types/experiment-snapshot";
import { QueryMap } from "back-end/src/queryRunners/QueryRunner";
import { updateSnapshotAnalysis } from "back-end/src/models/ExperimentSnapshotModel";
import { MAX_ROWS_UNIT_AGGREGATE_QUERY } from "back-end/src/integrations/SqlIntegration";
import { applyMetricOverrides } from "back-end/src/util/integration";
import { BanditResult } from "back-end/types/experiment";
import { statsServerPool } from "back-end/src/services/python";
import { metrics } from "back-end/src/util/metrics";

export const MAX_DIMENSIONS = 20;

export function getAnalysisSettingsForStatsEngine(
  settings: ExperimentSnapshotAnalysisSettings,
  variations: ExperimentReportVariation[],
  coverage: number,
  phaseLengthDays: number,
): AnalysisSettingsForStatsEngine {
  const sortedVariations = putBaselineVariationFirst(
    variations,
    settings.baselineVariationIndex ?? 0,
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
    p_value_corrected: !!settings.pValueCorrection,
    sequential_testing_enabled: settings.sequentialTesting ?? false,
    sequential_tuning_parameter: sequentialTestingTuningParameterNumber,
    difference_type: settings.differenceType,
    phase_length_days: phaseLengthDays,
    alpha: pValueThresholdNumber,
    max_dimensions:
      settings.dimensions[0]?.substring(0, 8) === "pre:date"
        ? 9999
        : MAX_DIMENSIONS,
    traffic_percentage: coverage,
    num_goal_metrics: settings.numGoalMetrics,
    one_sided_intervals: !!settings.oneSidedIntervals,
    post_stratification_enabled: false, //!!settings.postStratificationEnabled,
  };

  return analysisData;
}

export function getBanditSettingsForStatsEngine(
  banditSettings: SnapshotBanditSettings,
  settings: ExperimentSnapshotAnalysisSettings,
  variations: ExperimentReportVariation[],
): BanditSettingsForStatsEngine {
  const sortedVariations = putBaselineVariationFirst(
    variations,
    settings.baselineVariationIndex ?? 0,
  );
  return {
    reweight: banditSettings.reweight,
    var_names: sortedVariations.map((v) => v.name),
    var_ids: sortedVariations.map((v) => v.id),
    decision_metric: banditSettings.decisionMetric,
    bandit_weights_seed: banditSettings.seed,
    current_weights: banditSettings.currentWeights,
    historical_weights: banditSettings.historicalWeights.map((hw) => ({
      date: hw.date,
      weights: hw.weights,
      total_users: hw.totalUsers,
    })),
  };
}

export async function runStatsEngine(
  statsData: ExperimentDataForStatsEngine[],
): Promise<MultipleExperimentMetricAnalysis[]> {
  if (process.env.EXTERNAL_PYTHON_SERVER_URL) {
    const retVal = await fetch(
      `${process.env.EXTERNAL_PYTHON_SERVER_URL}/stats`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(statsData),
      },
    );
    if (!retVal.ok) {
      let { error } = await retVal.json();
      if (!error) {
        error = `Stats server errored with: ${retVal.status} - ${retVal.statusText}`;
      }
      logger.error(`Error fetching from stats engine: ${error}`);
      throw new Error(error);
    }
    const { results } = await retVal.json();
    return results;
  } else {
    const acquireStart = Date.now();
    const server = await statsServerPool.acquire();
    metrics
      .getHistogram("python.stats_pool_acquire_ms")
      .record(Date.now() - acquireStart);
    try {
      return await server.call(statsData);
    } finally {
      statsServerPool.release(server);
    }
  }
}

function createStatsEngineData(
  params: ExperimentMetricAnalysisParams,
): DataForStatsEngine {
  const {
    variations,
    metrics,
    phaseLengthHours,
    coverage,
    analyses,
    queryResults,
    banditSettings,
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
        phaseLengthDays,
      ),
    ),
    bandit_settings: banditSettings
      ? getBanditSettingsForStatsEngine(banditSettings, analyses[0], variations)
      : undefined,
  };
}

export async function runSnapshotAnalysis(
  params: ExperimentMetricAnalysisParams,
): Promise<{ results: ExperimentMetricAnalysis; banditResult?: BanditResult }> {
  const analysis: MultipleExperimentMetricAnalysis | undefined = (
    await runStatsEngine([
      { id: params.id, data: createStatsEngineData(params) },
    ])
  )?.[0];

  if (!analysis) {
    throw new Error("Error in stats engine: no rows returned");
  }
  if (analysis.error) {
    let errorMsg = "Failed to run stats model:\n" + analysis.error;
    logger.error(analysis.error, errorMsg);
    if (analysis.traceback) {
      logger.error("Traceback:\n" + analysis.traceback);
      errorMsg += "\n\n" + analysis.traceback;
    }
    throw new Error("Error in stats engine: " + errorMsg);
  }
  return {
    results: analysis.results,
    banditResult: analysis.banditResult,
  };
}

export async function runSnapshotAnalyses(
  params: ExperimentMetricAnalysisParams[],
): Promise<MultipleExperimentMetricAnalysis[]> {
  const paramsWithId = params.map((p) => {
    return { id: p.id, data: createStatsEngineData(p) };
  });
  const chunkSize = 10;
  const chunks = chunk(paramsWithId, chunkSize);
  const results: MultipleExperimentMetricAnalysis[][] = [];
  for (const chunk of chunks) {
    results.push(await runStatsEngine(chunk));
  }
  return results.flat();
}

function getBusinessMetricTypeForStatsEngine(
  metricId: string,
  settings: ExperimentSnapshotSettings,
): BusinessMetricTypeForStatsEngine[] {
  return [
    settings.goalMetrics.includes(metricId) ? ("goal" as const) : null,
    settings.secondaryMetrics.includes(metricId)
      ? ("secondary" as const)
      : null,
    settings.guardrailMetrics.includes(metricId)
      ? ("guardrail" as const)
      : null,
  ].filter((m) => m !== null);
}

export function getMetricSettingsForStatsEngine(
  metricDoc: ExperimentMetricInterface,
  metricMap: Map<string, ExperimentMetricInterface>,
  settings: ExperimentSnapshotSettings,
  optimizedFactMetric: boolean = false,
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
    isRegressionAdjusted(metric, denominator) &&
    // block RA for ratio metrics from non-optimized fact metrics
    (!isRatioMetric(metric, denominator) || optimizedFactMetric);
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
          : ratioMetric && regressionAdjusted
            ? "ratio_ra"
            : ratioMetric && !regressionAdjusted
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
    ...(regressionAdjusted && {
      covariate_metric_type: mainMetricType,
      keep_theta: !!settings.banditSettings,
    }),
    ...(!!quantileMetric && isFactMetric(metric)
      ? { quantile_value: metric.quantileSettings?.quantile ?? 0 }
      : {}),
    prior_proper: metric.priorSettings.proper,
    prior_mean: metric.priorSettings.mean,
    prior_stddev: metric.priorSettings.stddev,
    target_mde: metric.targetMDE ?? DEFAULT_TARGET_MDE,
    business_metric_type: getBusinessMetricTypeForStatsEngine(
      metric.id,
      settings,
    ),
  };
}

export function getMetricsAndQueryDataForStatsEngine(
  queryData: QueryMap,
  metricMap: Map<string, ExperimentMetricInterface>,
  settings: ExperimentSnapshotSettings,
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
            settings,
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
      if (
        key.match(/group_/) ||
        query.queryType === "experimentIncrementalRefreshStatistics"
      ) {
        const rows = query.result as ExperimentFactMetricsQueryResponseRows;
        if (!rows?.length) return;
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
              settings,
              true,
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
        settings,
        false,
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

function parseStatsEngineResult({
  analysisSettings,
  snapshotSettings,
  queryResults,
  unknownVariations,
  result,
}: {
  analysisSettings: ExperimentSnapshotAnalysisSettings[];
  snapshotSettings: ExperimentSnapshotSettings;
  queryResults: QueryResultsForStatsEngine[];
  unknownVariations: string[];
  result: ExperimentMetricAnalysis;
}): ExperimentReportResults[] {
  let unknownVariationsCopy = [...unknownVariations];

  const experimentReportResults: ExperimentReportResults[] = [];
  // TODO fix for dimension slices and move to health query
  const multipleExposures = Math.max(
    ...queryResults.map(
      (q) =>
        q.rows.filter((r) => r.variation === "__multiple__")?.[0]?.users || 0,
    ),
  );

  analysisSettings.forEach((_, i) => {
    const dimensionMap: Map<string, ExperimentReportResultDimension> =
      new Map();
    result.forEach(({ metric, analyses }) => {
      // each result can have multiple analyses (a set of computations that
      // use the same snapshot)
      // we loop over the analyses requested and pull out the results for each one
      const result = analyses[i];
      if (!result) return;

      unknownVariationsCopy = unknownVariationsCopy.concat(
        result.unknownVariations,
      );

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

          // translate null in CI to infinity
          const ci: [number, number] | undefined = v.ci
            ? [v.ci[0] ?? -Infinity, v.ci[1] ?? Infinity]
            : undefined;
          const parsedVariation = {
            ...v,
            ci,
          };
          data.metrics[metric] = {
            ...parsedVariation,
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
          snapshotSettings.variations.map((v) => v.weight),
        );
      });
    }
    experimentReportResults.push({
      multipleExposures,
      unknownVariations: Array.from(new Set(unknownVariationsCopy)),
      dimensions,
    });
  });
  return experimentReportResults;
}

export async function writeSnapshotAnalyses(
  results: MultipleExperimentMetricAnalysis[],
  paramsMap: Map<string, ExperimentAnalysisParamsContextData>,
) {
  const promises: (() => Promise<void>)[] = [];
  results.map((result) => {
    const params = paramsMap.get(result.id);
    if (!params) return;

    const { organization, snapshot, snapshotSettings } = params.context;
    const { analyses, queryResults } = params.params;
    const { analysisObj, unknownVariations } = params.data;

    if (result.error) {
      analysisObj.results = [];
      analysisObj.status = "error";
      analysisObj.error = result.error;
    } else {
      const experimentReportResults: ExperimentReportResults[] =
        parseStatsEngineResult({
          analysisSettings: analyses,
          snapshotSettings,
          queryResults,
          unknownVariations,
          result: result.results,
        });

      analysisObj.results = experimentReportResults[0]?.dimensions || [];
      analysisObj.status = "success";
      analysisObj.error = undefined;
    }

    promises.push(async () =>
      updateSnapshotAnalysis({
        organization,
        id: snapshot,
        analysis: analysisObj,
      }),
    );
  });
  if (promises.length > 0) {
    await promiseAllChunks(promises, 10);
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
}): Promise<{
  results: ExperimentReportResults[];
  banditResult?: BanditResult;
}> {
  const mdat = getMetricsAndQueryDataForStatsEngine(
    queryData,
    metricMap,
    snapshotSettings,
  );
  const { queryResults, metricSettings } = mdat;
  const { unknownVariations } = mdat;

  const params: ExperimentMetricAnalysisParams = {
    id: snapshotSettings.experimentId,
    coverage: snapshotSettings.coverage ?? 1,
    phaseLengthHours: Math.max(
      hoursBetween(snapshotSettings.startDate, snapshotSettings.endDate),
      1,
    ),
    variations: snapshotSettings.variations.map((v, i) => ({
      ...v,
      name: variationNames[i] || v.id,
    })),
    analyses: analysisSettings,
    queryResults: queryResults,
    metrics: metricSettings,
    banditSettings: snapshotSettings.banditSettings,
  };
  const { results: analysis, banditResult } = await runSnapshotAnalysis(params);

  const results = parseStatsEngineResult({
    analysisSettings,
    snapshotSettings,
    queryResults,
    unknownVariations,
    result: analysis,
  });
  return { results, banditResult };
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

  let banditSrmSet = false;
  rows.forEach((r) => {
    if (r.dimension_name === BANDIT_SRM_DIMENSION_NAME) {
      trafficResults.overall.srm = chi2pvalue(r.units, variations.length - 1);
      banditSrmSet = true;
    }
    const variationIndex = variationIdMap[r.variation];
    // skip if variation is not found (this happens if variation is __multiple__)
    if (variationIndex === undefined) return;
    const dimTraffic: Map<string, ExperimentSnapshotTrafficDimension> =
      dimTrafficResults.get(r.dimension_name) ?? new Map();
    const dimValueTraffic: ExperimentSnapshotTrafficDimension = dimTraffic.get(
      r.dimension_value,
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

  // compute SRM for non-bandits
  if (!banditSrmSet) {
    trafficResults.overall.srm = checkSrm(
      trafficResults.overall.variationUnits,
      variationWeights,
    );
  }

  for (const [dimName, dimTraffic] of dimTrafficResults) {
    for (const dimValueTraffic of dimTraffic.values()) {
      dimValueTraffic.srm = checkSrm(
        dimValueTraffic.variationUnits,
        variationWeights,
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
