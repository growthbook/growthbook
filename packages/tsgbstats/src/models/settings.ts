/**
 * Configuration and settings classes.
 * TypeScript port of gbstats/models/settings.py and related config classes.
 */

export type DifferenceType = "relative" | "absolute" | "scaled";

/**
 * Gaussian prior for Bayesian tests.
 */
export interface GaussianPrior {
  mean: number;
  variance: number;
  proper: boolean;
}

/**
 * Default Gaussian prior (improper flat prior).
 */
export const DEFAULT_GAUSSIAN_PRIOR: GaussianPrior = {
  mean: 0,
  variance: 1,
  proper: false,
};

/**
 * Base configuration for all tests.
 */
export interface BaseConfig {
  differenceType: DifferenceType;
  trafficPercentage: number;
  phaseLengthDays: number;
  totalUsers: number | null;
  alpha: number;
  postStratify: boolean;
}

/**
 * Default base configuration.
 */
export const DEFAULT_BASE_CONFIG: BaseConfig = {
  differenceType: "relative",
  trafficPercentage: 1,
  phaseLengthDays: 1,
  totalUsers: null,
  alpha: 0.05,
  postStratify: false,
};

/**
 * Frequentist test configuration.
 */
export interface FrequentistConfig extends BaseConfig {
  testValue: number;
}

/**
 * Default frequentist configuration.
 */
export const DEFAULT_FREQUENTIST_CONFIG: FrequentistConfig = {
  ...DEFAULT_BASE_CONFIG,
  testValue: 0,
};

/**
 * Sequential test configuration.
 */
export interface SequentialConfig extends FrequentistConfig {
  sequentialTuningParameter: number;
  rho: number | null;
}

/**
 * Default sequential configuration.
 */
export const DEFAULT_SEQUENTIAL_CONFIG: SequentialConfig = {
  ...DEFAULT_FREQUENTIST_CONFIG,
  sequentialTuningParameter: 5000,
  rho: null,
};

/**
 * Bayesian test configuration.
 */
export interface BayesianConfig extends BaseConfig {
  inverse: boolean;
  priorType: "relative" | "absolute";
}

/**
 * Default Bayesian configuration.
 */
export const DEFAULT_BAYESIAN_CONFIG: BayesianConfig = {
  ...DEFAULT_BASE_CONFIG,
  inverse: false,
  priorType: "relative",
};

/**
 * Effect Bayesian test configuration.
 */
export interface EffectBayesianConfig extends BayesianConfig {
  priorEffect: GaussianPrior;
}

/**
 * Default effect Bayesian configuration.
 */
export const DEFAULT_EFFECT_BAYESIAN_CONFIG: EffectBayesianConfig = {
  ...DEFAULT_BAYESIAN_CONFIG,
  priorEffect: DEFAULT_GAUSSIAN_PRIOR,
};

/**
 * Helper to create a frequentist config from partial options.
 */
export function createFrequentistConfig(
  options: Partial<FrequentistConfig> = {},
): FrequentistConfig {
  return { ...DEFAULT_FREQUENTIST_CONFIG, ...options };
}

/**
 * Helper to create a sequential config from partial options.
 */
export function createSequentialConfig(
  options: Partial<SequentialConfig> = {},
): SequentialConfig {
  return { ...DEFAULT_SEQUENTIAL_CONFIG, ...options };
}

/**
 * Helper to create an effect Bayesian config from partial options.
 */
export function createEffectBayesianConfig(
  options: Partial<EffectBayesianConfig> = {},
): EffectBayesianConfig {
  return { ...DEFAULT_EFFECT_BAYESIAN_CONFIG, ...options };
}

// ==============================================================
// High-Level API Settings (from gbstats/models/settings.py)
// ==============================================================

export type MetricType = "count" | "binomial";
export type StatisticType =
  | "mean"
  | "mean_ra"
  | "ratio"
  | "ratio_ra"
  | "quantile_event"
  | "quantile_unit";
export type StatsEngine = "bayesian" | "frequentist";

/**
 * Variation ID to index mapping.
 */
export type VarIdMap = Record<string, number>;

/**
 * Analysis settings for the stats engine.
 */
export interface AnalysisSettingsForStatsEngine {
  varNames: string[];
  varIds: string[];
  weights: number[];
  baselineIndex: number;
  dimension: string;
  statsEngine: StatsEngine;
  sequentialTestingEnabled: boolean;
  sequentialTuningParameter: number;
  differenceType: DifferenceType;
  phaseLengthDays: number;
  alpha: number;
  maxDimensions: number;
  oneSidedIntervals: boolean;
  trafficPercentage?: number;
  postStratificationEnabled?: boolean;
  pValueCorrected?: boolean;
  numGoalMetrics?: number;
}

/**
 * Default analysis settings.
 */
export const DEFAULT_ANALYSIS_SETTINGS: AnalysisSettingsForStatsEngine = {
  varNames: ["control", "treatment"],
  varIds: ["0", "1"],
  weights: [0.5, 0.5],
  baselineIndex: 0,
  dimension: "All",
  statsEngine: "bayesian",
  sequentialTestingEnabled: false,
  sequentialTuningParameter: 5000,
  differenceType: "relative",
  phaseLengthDays: 1,
  alpha: 0.05,
  maxDimensions: 20,
  oneSidedIntervals: false,
  trafficPercentage: 1,
  postStratificationEnabled: false,
  pValueCorrected: false,
  numGoalMetrics: 1,
};

/**
 * Metric settings for the stats engine.
 */
export interface MetricSettingsForStatsEngine {
  id: string;
  name: string;
  inverse: boolean;
  statisticType: StatisticType;
  mainMetricType: MetricType;
  denominatorMetricType?: MetricType;
  covariateMetricType?: MetricType;
  quantileValue?: number | null;
  priorMean?: number;
  priorStddev?: number;
  priorProper?: boolean;
  targetMde?: number;
  businessMetricType?: string | null;
  keepTheta?: boolean;
}

/**
 * Default metric settings.
 */
export const DEFAULT_METRIC_SETTINGS: MetricSettingsForStatsEngine = {
  id: "",
  name: "",
  inverse: false,
  statisticType: "mean",
  mainMetricType: "count",
  priorMean: 0,
  priorStddev: 0.5,
  priorProper: false,
  targetMde: 0.05,
  keepTheta: false,
};

/**
 * Bandit settings for the stats engine.
 */
export interface BanditSettingsForStatsEngine {
  varNames: string[];
  varIds: string[];
  currentWeights: number[];
  reweight: boolean;
  decisionMetric: string;
  banditWeightsSeed: number;
  weightByPeriod: boolean;
  topTwo: boolean;
}
