/**
 * High-level API for A/B test analysis.
 * TypeScript port of gbstats/gbstats.py
 */

import type {
  AnalysisSettingsForStatsEngine,
  MetricSettingsForStatsEngine,
  VarIdMap,
  GaussianPrior,
} from "./models/settings";
import type { TestStatistic } from "./models/statistics";
import {
  SampleMeanStatistic,
  ProportionStatistic,
  RatioStatistic,
  RegressionAdjustedStatistic,
  RegressionAdjustedRatioStatistic,
  QuantileStatistic,
  sumStats,
  createThetaAdjustedStatistics,
} from "./models/statistics";
import {
  TwoSidedTTest,
  SequentialTwoSidedTTest,
  OneSidedTreatmentGreaterTTest,
  OneSidedTreatmentLesserTTest,
  SequentialOneSidedTreatmentGreaterTTest,
  SequentialOneSidedTreatmentLesserTTest,
} from "./frequentist/tests";
import { EffectBayesianABTest } from "./bayesian/tests";
import type {
  FrequentistTestResult,
  BayesianTestResult,
} from "./models/results";
import { checkSrm } from "./utils";
import { createCoreAndSupplementalResults } from "./supplemental";

// ==============================================================
// Response Types
// ==============================================================

export interface MetricStats {
  users: number;
  count: number;
  stddev: number;
  mean: number;
}

export interface Uplift {
  dist: string;
  mean: number;
  stddev: number;
}

export type ResponseCI = [number | null, number | null];

export interface BaselineResponse {
  cr: number;
  value: number;
  users: number;
  denominator: number;
  stats: MetricStats;
}

export interface RealizedSettings {
  postStratificationApplied: boolean;
}

export interface BaseVariationResponse extends BaselineResponse {
  expected: number;
  uplift: Uplift;
  ci: ResponseCI;
  errorMessage: string | null;
  power: null;
  realizedSettings: RealizedSettings;
}

// Individual variation response without supplemental (for nesting)
export interface BayesianVariationResponseIndividual
  extends BaseVariationResponse {
  chanceToWin: number;
  risk: [number, number];
  riskType: "relative" | "absolute";
}

export interface FrequentistVariationResponseIndividual
  extends BaseVariationResponse {
  pValue: number | null;
  pValueErrorMessage?: string | null;
}

export type VariationResponseIndividual =
  | BaselineResponse
  | BayesianVariationResponseIndividual
  | FrequentistVariationResponseIndividual;

export interface SupplementalResults {
  cupedUnadjusted: VariationResponseIndividual | null;
  uncapped: VariationResponseIndividual | null;
  flatPrior: VariationResponseIndividual | null;
  unstratified: VariationResponseIndividual | null;
  noVarianceReduction: VariationResponseIndividual | null;
}

export interface BayesianVariationResponse
  extends BayesianVariationResponseIndividual {
  supplementalResults?: SupplementalResults;
}

export interface FrequentistVariationResponse
  extends FrequentistVariationResponseIndividual {
  supplementalResults?: SupplementalResults;
}

export interface BaselineResponseWithSupplementalResults
  extends BaselineResponse {
  supplementalResults?: SupplementalResults;
}

export type VariationResponse =
  | BaselineResponse
  | BayesianVariationResponse
  | FrequentistVariationResponse;

export interface DimensionResponse {
  dimension: string;
  srm: number;
  variations: VariationResponse[];
}

// ==============================================================
// Data Structures
// ==============================================================

export interface DimensionMetricData {
  dimension: string;
  totalUnits: number;
  data: Record<string, unknown>[];
}

// ==============================================================
// Core Functions
// ==============================================================

/**
 * Looks for any variation ids that are not in the provided map.
 */
export function detectUnknownVariations(
  rows: Record<string, unknown>[],
  varIds: Set<string>,
  ignoreIds: Set<string> = new Set(["__multiple__"]),
): Set<string> {
  const unknownVarIds = new Set<string>();
  for (const row of rows) {
    const id = String(row.variation);
    if (!ignoreIds.has(id) && !varIds.has(id)) {
      unknownVarIds.add(id);
    }
  }
  return unknownVarIds;
}

/**
 * Get the dimension column name based on dimension type.
 */
export function getDimensionColumnName(dimension: string): string {
  let dimensionColumnName = "dimension";
  if (dimension === "pre:date") {
    dimensionColumnName = "dim_pre_date";
  } else if (dimension === "pre:activation") {
    dimensionColumnName = "dim_activation";
  } else if (dimension.startsWith("exp:")) {
    dimensionColumnName = "dim_exp_" + dimension.split(":")[1];
  } else if (dimension.startsWith("precomputed:")) {
    dimensionColumnName = "dim_exp_" + dimension.split(":")[1];
  } else if (dimension.startsWith("dim_")) {
    dimensionColumnName = "dim_unit_" + dimension;
  }
  return dimensionColumnName;
}

// Column names for summable and non-summable data
const SUM_COLS = [
  "users",
  "count",
  "main_sum",
  "main_sum_squares",
  "denominator_sum",
  "denominator_sum_squares",
  "main_denominator_sum_product",
  "covariate_sum",
  "covariate_sum_squares",
  "main_covariate_sum_product",
  "denominator_pre_sum",
  "denominator_pre_sum_squares",
  "main_post_denominator_pre_sum_product",
  "main_pre_denominator_post_sum_product",
  "main_pre_denominator_pre_sum_product",
  "denominator_post_denominator_pre_sum_product",
];

const NON_SUMMABLE_COLS = [
  "quantile_n",
  "quantile_nstar",
  "quantile",
  "quantile_lower",
  "quantile_upper",
  "theta",
];

const ROW_COLS = [...SUM_COLS, ...NON_SUMMABLE_COLS];

/**
 * Transform raw SQL result for metrics into a dataframe per dimension level.
 */
export function getMetricDfs(
  rows: Record<string, unknown>[],
  varIdMap: VarIdMap,
  varNames: string[],
  dimension?: string,
  _postStratify: boolean = false,
): DimensionMetricData[] {
  const dimensions: Map<
    string,
    { totalUnits: number; data: Map<string, Record<string, unknown>> }
  > = new Map();
  const dimensionColumnName = dimension
    ? getDimensionColumnName(dimension)
    : "dimension";

  // Each row in the raw SQL result is a dimension/variation combo
  for (const row of rows) {
    const dim = String(row[dimensionColumnName] ?? row["dimension"] ?? "");
    const strata = ""; // For non-post-stratified, all data in same strata

    // Initialize dimension if first time seeing it
    if (!dimensions.has(dim)) {
      dimensions.set(dim, { totalUnits: 0, data: new Map() });
    }
    const dimData = dimensions.get(dim)!;

    // Initialize strata if first time seeing it
    if (!dimData.data.has(strata)) {
      const strataData: Record<string, unknown> = {
        dimension: dim,
        strata: strata,
      };

      // Add columns for each variation
      for (const [key, idx] of Object.entries(varIdMap)) {
        const prefix = idx > 0 ? `v${idx}` : "baseline";
        strataData[`${prefix}_id`] = key;
        strataData[`${prefix}_name`] = varNames[idx];
        for (const col of ROW_COLS) {
          strataData[`${prefix}_${col}`] = 0;
        }
      }
      dimData.data.set(strata, strataData);
    }

    // Add this SQL result row into the dimension dict if we recognize the variation
    const key = String(row.variation);
    if (key in varIdMap) {
      const idx = varIdMap[key];
      dimData.totalUnits += (row.users as number) || 0;
      const prefix = idx > 0 ? `v${idx}` : "baseline";
      const strataData = dimData.data.get(strata)!;

      // Sum summable columns
      for (const col of SUM_COLS) {
        const rowVal = row[col];
        // Handle missing count - fall back to users (matches Python behavior)
        if (
          col === "count" &&
          (rowVal === undefined ||
            rowVal === null ||
            typeof rowVal === "function")
        ) {
          strataData[`${prefix}_count`] =
            (strataData[`${prefix}_count`] as number) +
            ((row.users as number) || 0);
        } else {
          strataData[`${prefix}_${col}`] =
            (strataData[`${prefix}_${col}`] as number) +
            ((rowVal as number) || 0);
        }
      }

      // Non-summable columns (should only be set once)
      for (const col of NON_SUMMABLE_COLS) {
        if (strataData[`${prefix}_${col}`] === 0) {
          strataData[`${prefix}_${col}`] = row[col] ?? 0;
        }
      }
    }
  }

  // Convert to output format
  return Array.from(dimensions.entries()).map(([dim, dimData]) => ({
    dimension: dim,
    totalUnits: dimData.totalUnits,
    data: Array.from(dimData.data.values()),
  }));
}

/**
 * Limit to the top X dimensions with the most users.
 * Merge the rest into an "(other)" dimension.
 */
export function reduceDimensionality(
  metricData: DimensionMetricData[],
  numVariations: number,
  max: number = 20,
  keepOther: boolean = true,
  combineStrata: boolean = true,
): DimensionMetricData[] {
  // Sort by total units descending
  const sorted = [...metricData].sort((a, b) => b.totalUnits - a.totalUnits);

  const newMetricData: DimensionMetricData[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const dimension = sorted[i];

    // For the first few dimensions, keep them as-is
    if (i < max) {
      newMetricData.push(dimension);
    } else if (keepOther) {
      // Merge into the last dimension as "(other)"
      const current = newMetricData[max - 1];
      current.dimension = "(other)";
      current.totalUnits += dimension.totalUnits;

      if (combineStrata) {
        // Sum data across dimensions
        for (const dimRow of dimension.data) {
          const currentRow = current.data[0];
          for (let v = 0; v < numVariations; v++) {
            const prefix = v > 0 ? `v${v}` : "baseline";
            for (const col of SUM_COLS) {
              currentRow[`${prefix}_${col}`] =
                (currentRow[`${prefix}_${col}`] as number) +
                ((dimRow[`${prefix}_${col}`] as number) || 0);
            }
          }
        }
      } else {
        // Concatenate rows
        current.data.push(...dimension.data);
      }
    }
  }

  return newMetricData;
}

/**
 * Build a statistic from a metric row.
 */
export function variationStatisticFromMetricRow(
  row: Record<string, unknown>,
  prefix: string,
  metric: MetricSettingsForStatsEngine,
): TestStatistic {
  const statisticType = metric.statisticType;

  if (statisticType === "quantile_unit") {
    if (metric.quantileValue === null || metric.quantileValue === undefined) {
      throw new Error("quantileValue must be set for quantile_unit metric");
    }
    return new QuantileStatistic({
      n: row[`${prefix}_quantile_n`] as number,
      n_star: row[`${prefix}_quantile_nstar`] as number,
      nu: metric.quantileValue,
      quantile_hat: row[`${prefix}_quantile`] as number,
      quantile_lower: row[`${prefix}_quantile_lower`] as number,
      quantile_upper: row[`${prefix}_quantile_upper`] as number,
    });
  } else if (statisticType === "ratio") {
    return new RatioStatistic({
      n: row[`${prefix}_users`] as number,
      m_statistic: baseStatisticFromMetricRow(
        row,
        prefix,
        "main",
        metric.mainMetricType,
      ),
      d_statistic: baseStatisticFromMetricRow(
        row,
        prefix,
        "denominator",
        metric.denominatorMetricType || "count",
      ),
      m_d_sum_of_products: row[
        `${prefix}_main_denominator_sum_product`
      ] as number,
    });
  } else if (statisticType === "mean") {
    return baseStatisticFromMetricRow(
      row,
      prefix,
      "main",
      metric.mainMetricType,
    );
  } else if (statisticType === "mean_ra") {
    const postStatistic = baseStatisticFromMetricRow(
      row,
      prefix,
      "main",
      metric.mainMetricType,
    );
    const preStatistic = baseStatisticFromMetricRow(
      row,
      prefix,
      "covariate",
      metric.covariateMetricType || "count",
    );
    const postPreSumOfProducts = row[
      `${prefix}_main_covariate_sum_product`
    ] as number;
    const n = row[`${prefix}_users`] as number;
    let theta: number | null = null;
    if (metric.keepTheta) {
      theta = (row[`${prefix}_theta`] as number) ?? 0;
    }
    return new RegressionAdjustedStatistic({
      n,
      post_statistic: postStatistic,
      pre_statistic: preStatistic,
      post_pre_sum_of_products: postPreSumOfProducts,
      theta,
    });
  } else if (statisticType === "ratio_ra") {
    const mStatisticPost = baseStatisticFromMetricRow(
      row,
      prefix,
      "main",
      metric.mainMetricType,
    );
    const dStatisticPost = baseStatisticFromMetricRow(
      row,
      prefix,
      "denominator",
      metric.denominatorMetricType || "count",
    );
    const mStatisticPre = baseStatisticFromMetricRow(
      row,
      prefix,
      "covariate",
      metric.mainMetricType,
    );
    const dStatisticPre = baseStatisticFromMetricRow(
      row,
      prefix,
      "denominator_pre",
      metric.denominatorMetricType || "count",
    );
    return new RegressionAdjustedRatioStatistic({
      n: row[`${prefix}_users`] as number,
      m_statistic_post: mStatisticPost,
      d_statistic_post: dStatisticPost,
      m_statistic_pre: mStatisticPre,
      d_statistic_pre: dStatisticPre,
      m_post_m_pre_sum_of_products: row[
        `${prefix}_main_covariate_sum_product`
      ] as number,
      d_post_d_pre_sum_of_products: row[
        `${prefix}_denominator_post_denominator_pre_sum_product`
      ] as number,
      m_pre_d_pre_sum_of_products: row[
        `${prefix}_main_pre_denominator_pre_sum_product`
      ] as number,
      m_post_d_post_sum_of_products: row[
        `${prefix}_main_denominator_sum_product`
      ] as number,
      m_post_d_pre_sum_of_products: row[
        `${prefix}_main_post_denominator_pre_sum_product`
      ] as number,
      m_pre_d_post_sum_of_products: row[
        `${prefix}_main_pre_denominator_post_sum_product`
      ] as number,
      theta: null,
    });
  } else {
    throw new Error(`Unexpected statisticType: ${statisticType}`);
  }
}

/**
 * Build a base statistic (SampleMean or Proportion) from a metric row.
 */
export function baseStatisticFromMetricRow(
  row: Record<string, unknown>,
  prefix: string,
  component: string,
  metricType: string,
): SampleMeanStatistic | ProportionStatistic {
  if (metricType === "binomial") {
    return new ProportionStatistic({
      sum: row[`${prefix}_${component}_sum`] as number,
      n: row[`${prefix}_count`] as number,
    });
  } else if (metricType === "count") {
    return new SampleMeanStatistic({
      sum: row[`${prefix}_${component}_sum`] as number,
      sum_squares: row[`${prefix}_${component}_sum_squares`] as number,
      n: row[`${prefix}_count`] as number,
    });
  } else {
    throw new Error(`Unexpected metricType: ${metricType}`);
  }
}

/**
 * Get the configured test based on analysis settings.
 */
function getConfiguredTest(
  stats: Array<[TestStatistic, TestStatistic]>,
  totalUsers: number,
  analysis: AnalysisSettingsForStatsEngine,
  metric: MetricSettingsForStatsEngine,
) {
  const baseConfig = {
    totalUsers,
    trafficPercentage: analysis.trafficPercentage ?? 1,
    phaseLengthDays: analysis.phaseLengthDays,
    differenceType: analysis.differenceType as "relative" | "absolute",
    postStratify: analysis.postStratificationEnabled ?? false,
  };

  if (analysis.statsEngine === "frequentist") {
    if (analysis.sequentialTestingEnabled) {
      const seqConfig = {
        ...baseConfig,
        ...(analysis.alpha !== undefined && { alpha: analysis.alpha }),
        sequentialTuningParameter: analysis.sequentialTuningParameter,
      };
      if (analysis.oneSidedIntervals) {
        if (metric.inverse) {
          return new SequentialOneSidedTreatmentGreaterTTest(stats, seqConfig);
        } else {
          return new SequentialOneSidedTreatmentLesserTTest(stats, seqConfig);
        }
      } else {
        return new SequentialTwoSidedTTest(stats, seqConfig);
      }
    } else {
      const freqConfig = {
        ...baseConfig,
        ...(analysis.alpha !== undefined && { alpha: analysis.alpha }),
      };
      if (analysis.oneSidedIntervals) {
        if (metric.inverse) {
          return new OneSidedTreatmentGreaterTTest(stats, freqConfig);
        } else {
          return new OneSidedTreatmentLesserTTest(stats, freqConfig);
        }
      } else {
        return new TwoSidedTTest(stats, freqConfig);
      }
    }
  } else {
    // Bayesian
    const prior: GaussianPrior = {
      mean: metric.priorMean ?? 0,
      variance: Math.pow(metric.priorStddev ?? 0.5, 2),
      proper: metric.priorProper ?? false,
    };
    return new EffectBayesianABTest(stats, {
      ...baseConfig,
      inverse: metric.inverse,
      priorEffect: prior,
      priorType: "relative",
    });
  }
}

/**
 * Get the metric response (baseline stats) for a variation.
 */
function getMetricResponse(
  metricRows: Record<string, unknown>[],
  statistic: TestStatistic,
  v: number,
): BaselineResponse {
  const prefix = v > 0 ? `v${v}` : "baseline";

  // Sum values across all rows
  let users = 0;
  let count = 0;
  let mainSum = 0;
  let denominatorSum = 0;

  for (const row of metricRows) {
    users += (row[`${prefix}_users`] as number) || 0;
    count += (row[`${prefix}_count`] as number) || 0;
    mainSum += (row[`${prefix}_main_sum`] as number) || 0;
    denominatorSum += (row[`${prefix}_denominator_sum`] as number) || 0;
  }

  const stats: MetricStats = {
    users,
    count,
    stddev: statistic.stddev,
    mean: statistic.unadjustedMean,
  };

  return {
    cr: statistic.unadjustedMean,
    value: mainSum,
    users,
    denominator: denominatorSum,
    stats,
  };
}

/**
 * Run A/B test analysis for each variation and dimension.
 */
export function analyzeMetricDf(
  metricData: DimensionMetricData[],
  numVariations: number,
  metric: MetricSettingsForStatsEngine,
  analysis: AnalysisSettingsForStatsEngine,
): DimensionResponse[] {
  function analyzeDimension(
    dimensionData: DimensionMetricData,
  ): DimensionResponse {
    const d = dimensionData.data;
    const variationData: VariationResponse[] = [];
    let baselineStat: TestStatistic | null = null;

    // Loop through each non-baseline variation and run an analysis
    for (let i = 1; i < numVariations; i++) {
      const controlStats: TestStatistic[] = [];
      const variationStats: TestStatistic[] = [];

      // Get one statistic per row
      for (const row of d) {
        controlStats.push(
          variationStatisticFromMetricRow(row, "baseline", metric),
        );
        variationStats.push(
          variationStatisticFromMetricRow(row, `v${i}`, metric),
        );
      }

      const stats: Array<[TestStatistic, TestStatistic]> = controlStats.map(
        (c, idx) => [c, variationStats[idx]],
      );

      const test = getConfiguredTest(
        stats,
        dimensionData.totalUnits,
        analysis,
        metric,
      );
      const res = test.computeResult();

      // Capture baseline stat (use theta-adjusted statistic from the test)
      baselineStat = test.statA;

      const metricResponse = getMetricResponse(d, test.statB, i);
      const ci: ResponseCI = [
        res.ci[0] === -Infinity ? null : res.ci[0],
        res.ci[1] === Infinity ? null : res.ci[1],
      ];

      // Build variation response based on test type
      const baseVariationResponse: BaseVariationResponse = {
        ...metricResponse,
        expected: res.expected,
        uplift: res.uplift,
        ci,
        errorMessage: res.errorMessage,
        power: null,
        realizedSettings: {
          postStratificationApplied: false,
        },
      };

      if ("chanceToWin" in res) {
        // Bayesian result
        const bayesRes = res as BayesianTestResult;
        const bayesianResponse: BayesianVariationResponse = {
          ...baseVariationResponse,
          chanceToWin: bayesRes.chanceToWin,
          risk: bayesRes.risk,
          riskType: bayesRes.riskType,
        };
        variationData.push(bayesianResponse);
      } else {
        // Frequentist result
        const freqRes = res as FrequentistTestResult;
        const frequentistResponse: FrequentistVariationResponse = {
          ...baseVariationResponse,
          pValue: freqRes.pValue,
          pValueErrorMessage: freqRes.pValueErrorMessage,
        };
        variationData.push(frequentistResponse);
      }
    }

    // Calculate SRM
    const variationUserCounts: number[] = [];
    for (let v = 0; v < numVariations; v++) {
      const prefix = v > 0 ? `v${v}` : "baseline";
      let sum = 0;
      for (const row of d) {
        sum += (row[`${prefix}_users`] as number) || 0;
      }
      variationUserCounts.push(sum);
    }
    const srmP = checkSrm(variationUserCounts, analysis.weights);

    // Insert baseline data at the appropriate position
    if (baselineStat === null && d.length > 0) {
      // Edge case: no treatment variations, compute baseline stat directly
      const controlStats: TestStatistic[] = [];
      for (const row of d) {
        controlStats.push(
          variationStatisticFromMetricRow(row, "baseline", metric),
        );
      }
      const stats: Array<[TestStatistic, TestStatistic]> = controlStats.map(
        (c) => [c, c],
      );
      const [summedA, summedB] = sumStats(stats);
      const [adjustedA] = createThetaAdjustedStatistics(summedA, summedB);
      baselineStat = adjustedA;
    }

    if (baselineStat) {
      const baselineData = getMetricResponse(d, baselineStat, 0);
      variationData.splice(analysis.baselineIndex, 0, baselineData);
    }

    return {
      dimension: dimensionData.dimension,
      srm: srmP,
      variations: variationData,
    };
  }

  return metricData.map(analyzeDimension);
}

/**
 * Run a specific analysis given data and configuration settings.
 */
export function processAnalysis(
  rows: Record<string, unknown>[],
  varIdMap: VarIdMap,
  metric: MetricSettingsForStatsEngine,
  analysis: AnalysisSettingsForStatsEngine,
): DimensionResponse[] {
  const varNames = analysis.varNames;
  const maxDimensions = analysis.maxDimensions;

  // Convert raw SQL result into dimension-grouped data
  const metricData = getMetricDfs(
    rows,
    varIdMap,
    varNames,
    analysis.dimension,
    analysis.postStratificationEnabled ?? false,
  );

  // Determine if we keep the "(other)" dimension
  let keepOther = true;
  if (
    metric.statisticType === "quantile_event" ||
    metric.statisticType === "quantile_unit"
  ) {
    keepOther = false;
  }
  if (metric.keepTheta && metric.statisticType === "mean_ra") {
    keepOther = false;
  }

  // Reduce dimensionality
  const reducedMetricData = reduceDimensionality(
    metricData,
    varNames.length,
    maxDimensions,
    keepOther,
    !(analysis.postStratificationEnabled ?? false),
  );

  // Run the analysis with supplemental results
  return createCoreAndSupplementalResults(
    reducedMetricData,
    varNames.length,
    metric,
    analysis,
  );
}

/**
 * Get variation ID to index map.
 */
export function getVarIdMap(varIds: string[]): VarIdMap {
  const map: VarIdMap = {};
  varIds.forEach((v, i) => {
    map[v] = i;
  });
  return map;
}

// ==============================================================
// High-level API types
// ==============================================================

export interface ExperimentMetricAnalysisResult {
  unknownVariations: string[];
  multipleExposures: number;
  dimensions: DimensionResponse[];
}

export interface ExperimentMetricAnalysis {
  metric: string;
  analyses: ExperimentMetricAnalysisResult[];
}

/**
 * Process a single metric through the full analysis pipeline.
 * This is the main entry point for analyzing experiment metrics.
 */
export function processSingleMetric(
  rows: Record<string, unknown>[],
  metric: MetricSettingsForStatsEngine,
  analyses: AnalysisSettingsForStatsEngine[],
): ExperimentMetricAnalysis {
  // If no data, return blank results
  if (rows.length === 0) {
    return {
      metric: metric.id,
      analyses: analyses.map(() => ({
        unknownVariations: [],
        multipleExposures: 0,
        dimensions: [],
      })),
    };
  }

  // Detect unknown variations
  const allVarIds = new Set<string>();
  for (const a of analyses) {
    for (const v of a.varIds) {
      allVarIds.add(v);
    }
  }
  const unknownVarIds = Array.from(detectUnknownVariations(rows, allVarIds));

  const results: DimensionResponse[][] = [];
  for (const a of analyses) {
    // Skip quantile dimension reaggregation
    const attemptedQuantileDimensionReaggregation =
      a.dimension.startsWith("precomputed:") &&
      (metric.statisticType === "quantile_event" ||
        metric.statisticType === "quantile_unit");
    if (attemptedQuantileDimensionReaggregation) {
      continue;
    }

    results.push(processAnalysis(rows, getVarIdMap(a.varIds), metric, a));
  }

  return {
    metric: metric.id,
    analyses: results.map((r) => ({
      unknownVariations: unknownVarIds,
      multipleExposures: 0,
      dimensions: r,
    })),
  };
}
