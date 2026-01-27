/**
 * Shadow testing service for validating TypeScript stats engine against Python.
 *
 * This service runs the TypeScript stats engine in parallel with Python,
 * compares the results, and stores comparison records for analysis.
 */

import {
  ExperimentDataForStatsEngine,
  MultipleExperimentMetricAnalysis,
  AnalysisSettingsForStatsEngine as PythonAnalysisSettings,
  MetricSettingsForStatsEngine as PythonMetricSettings,
} from "shared/types/stats";
import {
  processSingleMetric,
  type AnalysisSettingsForStatsEngine as TsAnalysisSettings,
  type MetricSettingsForStatsEngine as TsMetricSettings,
  type ExperimentMetricAnalysis,
} from "tsgbstats";
import { StatsShadowComparisonModel } from "back-end/src/models/StatsShadowComparisonModel";
import { logger } from "back-end/src/util/logger";
import { ApiReqContext } from "back-end/types/api";
import { ReqContext } from "back-end/types/request";

type Context = ApiReqContext | ReqContext;

export interface ShadowComparisonInput {
  experiments: ExperimentDataForStatsEngine[];
  pythonResult: MultipleExperimentMetricAnalysis[];
  pythonDurationMs: number;
  context: Context;
}

interface ComparisonResult {
  status: "match" | "mismatch" | "ts_error";
  diff?: {
    summary: string;
    pythonJson: string;
    tsJson: string;
  };
}

/**
 * Convert Python snake_case analysis settings to TypeScript camelCase.
 */
function convertAnalysisSettings(
  python: PythonAnalysisSettings,
): TsAnalysisSettings {
  return {
    varNames: python.var_names,
    varIds: python.var_ids,
    weights: python.weights,
    baselineIndex: python.baseline_index,
    dimension: python.dimension,
    statsEngine: python.stats_engine as "bayesian" | "frequentist",
    sequentialTestingEnabled: python.sequential_testing_enabled,
    sequentialTuningParameter: python.sequential_tuning_parameter,
    differenceType: python.difference_type as
      | "relative"
      | "absolute"
      | "scaled",
    phaseLengthDays: python.phase_length_days,
    alpha: python.alpha,
    maxDimensions: python.max_dimensions,
    oneSidedIntervals: python.one_sided_intervals ?? false,
    trafficPercentage: python.traffic_percentage,
    postStratificationEnabled: python.post_stratification_enabled,
    pValueCorrected: python.p_value_corrected,
    numGoalMetrics: python.num_goal_metrics,
  };
}

/**
 * Convert Python snake_case metric settings to TypeScript camelCase.
 */
function convertMetricSettings(python: PythonMetricSettings): TsMetricSettings {
  return {
    id: python.id,
    name: python.name,
    inverse: python.inverse,
    statisticType: python.statistic_type,
    mainMetricType: python.main_metric_type as "count" | "binomial",
    denominatorMetricType: python.denominator_metric_type as
      | "count"
      | "binomial"
      | undefined,
    covariateMetricType: python.covariate_metric_type as
      | "count"
      | "binomial"
      | undefined,
    quantileValue: python.quantile_value,
    priorMean: python.prior_mean,
    priorStddev: python.prior_stddev,
    priorProper: python.prior_proper,
    targetMde: python.target_mde,
    keepTheta: python.keep_theta,
  };
}

/**
 * Run the TypeScript stats engine on a single experiment's data.
 */
function runTsStatsForExperiment(
  data: ExperimentDataForStatsEngine["data"],
): ExperimentMetricAnalysis[] {
  const { analyses, metrics, query_results } = data;

  // Convert settings to TypeScript format
  const tsAnalyses = analyses.map(convertAnalysisSettings);

  // Process each metric
  const results: ExperimentMetricAnalysis[] = [];

  for (const [metricId, pythonMetricSettings] of Object.entries(metrics)) {
    const tsMetricSettings = convertMetricSettings(pythonMetricSettings);

    // Find the rows for this metric from query_results
    const rows: Record<string, unknown>[] = [];
    for (const qr of query_results) {
      // Check if this query result contains data for this metric
      const metricIndex = qr.metrics.findIndex((m) => m === metricId);
      if (metricIndex >= 0) {
        // For multi-metric queries, we need to extract the relevant columns
        if (qr.metrics.length > 1) {
          // Multi-metric query - extract columns with prefix m{index}_
          const prefix = `m${metricIndex}_`;
          for (const row of qr.rows) {
            const extractedRow: Record<string, unknown> = {
              dimension: row.dimension,
              variation: row.variation,
            };
            // Extract metric-specific columns
            for (const [key, value] of Object.entries(row)) {
              if (key.startsWith(prefix)) {
                const newKey = key.substring(prefix.length);
                extractedRow[newKey] = value;
              }
            }
            // Copy non-prefixed columns that are metric data
            if ("users" in row) extractedRow.users = row.users;
            rows.push(extractedRow);
          }
        } else {
          // Single-metric query - use rows directly
          rows.push(...(qr.rows as Record<string, unknown>[]));
        }
      }
    }

    // Run the TypeScript stats engine
    const result = processSingleMetric(rows, tsMetricSettings, tsAnalyses);
    results.push(result);
  }

  return results;
}

/**
 * Run the TypeScript stats engine and return results in the same format as Python.
 *
 * Note: We use type assertions because the tsgbstats types are slightly different
 * from the shared types (e.g., errorMessage: string | null vs string | undefined).
 * Since we're doing JSON string comparison, the exact types don't matter at runtime.
 */
function runTsStatsEngine(
  experiments: ExperimentDataForStatsEngine[],
): MultipleExperimentMetricAnalysis[] {
  return experiments.map((exp) => {
    try {
      const results = runTsStatsForExperiment(exp.data);
      return {
        id: exp.id,
        // Cast to shared type - the structure is the same, just minor type differences
        results:
          results as unknown as MultipleExperimentMetricAnalysis["results"],
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      return {
        id: exp.id,
        results: [] as MultipleExperimentMetricAnalysis["results"],
        error: err.message,
        traceback: err.stack,
      };
    }
  });
}

/**
 * Compare Python and TypeScript results using JSON string comparison.
 */
function compareResults(
  pythonResult: MultipleExperimentMetricAnalysis[],
  tsResult: MultipleExperimentMetricAnalysis[],
): ComparisonResult {
  const pythonJson = JSON.stringify(pythonResult);
  const tsJson = JSON.stringify(tsResult);

  if (pythonJson === tsJson) {
    return { status: "match" };
  }

  return {
    status: "mismatch",
    diff: {
      summary: `JSON strings differ (Python: ${pythonJson.length} chars, TS: ${tsJson.length} chars)`,
      pythonJson,
      tsJson,
    },
  };
}

/**
 * Run shadow comparison: execute TypeScript stats, compare with Python, and store results.
 *
 * This function is designed to be called in a fire-and-forget manner.
 * Errors are logged but do not affect the main Python stats flow.
 */
export async function runShadowComparison(
  input: ShadowComparisonInput,
): Promise<void> {
  const { experiments, pythonResult, pythonDurationMs, context } = input;

  // Extract experiment ID (use first experiment's ID if multiple)
  const experimentId = experiments[0]?.id || "unknown";

  const startTime = Date.now();
  let tsResult: MultipleExperimentMetricAnalysis[] | undefined;
  let tsError: { message: string; stack?: string } | undefined;
  let status: "match" | "mismatch" | "ts_error";
  let diff: { summary: string; pythonJson: string; tsJson: string } | undefined;

  try {
    // Run TypeScript stats engine
    tsResult = runTsStatsEngine(experiments);
    const tsDurationMs = Date.now() - startTime;

    // Check if any experiment had an error
    const hasError = tsResult.some((r) => r.error);
    if (hasError) {
      const errorResult = tsResult.find((r) => r.error);
      throw new Error(errorResult?.error || "Unknown TypeScript stats error");
    }

    // Compare results
    const comparison = compareResults(pythonResult, tsResult);
    status = comparison.status;
    diff = comparison.diff;

    // Log for monitoring
    if (status === "match") {
      logger.info("Shadow comparison: MATCH", {
        experimentId,
        pythonDurationMs,
        tsDurationMs,
      });
    } else {
      logger.warn("Shadow comparison: MISMATCH", {
        experimentId,
        pythonDurationMs,
        tsDurationMs,
        diffSummary: diff?.summary,
      });
    }
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    tsError = {
      message: err.message,
      stack: err.stack,
    };
    status = "ts_error";

    logger.error("Shadow comparison: TypeScript error", {
      experimentId,
      error: err.message,
      stack: err.stack,
    });
  }

  // Store comparison record
  try {
    const model = new StatsShadowComparisonModel(context);
    await model.create({
      experimentId,
      input: experiments,
      pythonResult: {
        results: pythonResult,
        durationMs: pythonDurationMs,
      },
      ...(tsResult && {
        tsResult: {
          results: tsResult,
          durationMs: Date.now() - startTime,
        },
      }),
      ...(tsError && { tsError }),
      status,
      ...(diff && { diff }),
    });
  } catch (error) {
    // Log but don't throw - storing the comparison should not affect the main flow
    logger.error("Failed to store shadow comparison", {
      experimentId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
