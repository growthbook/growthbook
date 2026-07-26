export { StatsEngine } from "shared/validators";

import { BanditResult } from "shared/validators";
import {
  ExperimentFactMetricsQueryResponseRows,
  ExperimentMetricQueryResponseRows,
} from "shared/types/integrations";
import type { MetricStats } from "./metric";

export type PValueCorrection = null | "benjamini-hochberg" | "holm-bonferroni";

export type IndexedPValue = {
  pValue: number;
  index: [number, number, string];
};

export type DifferenceType = "relative" | "absolute" | "scaled";

// Mirrors the return shape of `useConfidenceLevels`. Grouped together so
// consumers can receive either the whole bundle (for Bayesian chance-to-win
// comparisons / display strings) or any single piece of it without pulling
// in an unrelated p-value threshold.
export interface BayesianConfidenceLevels {
  // Upper confidence bound (e.g. 0.95).
  ciUpper: number;
  // Lower confidence bound (e.g. 0.05, = 1 - ciUpper).
  ciLower: number;
  // Pre-rendered display strings (e.g. "95%" / "5%").
  ciUpperDisplay: string;
  ciLowerDisplay: string;
}

// Project-aware significance thresholds used by experiment result UIs. Keep
// these resolved (via useConfidenceLevels / usePValueThreshold) at the top of
// the results tree and thread them through to all sub-components so they all
// render against the same project-scoped settings.
export interface SignificanceThresholds {
  // Bayesian CI bounds + display strings.
  bayesianConfidenceLevels: BayesianConfidenceLevels;
  // Used for frequentist analysis.
  pValueThreshold: number;
}

export type RiskType = "relative" | "absolute";

export type PValueErrorMessage =
  | "NUMERICAL_PVALUE_NOT_CONVERGED"
  | "ALPHA_GREATER_THAN_0.5_FOR_SEQUENTIAL_ONE_SIDED_TEST";

export interface BaselineResponse {
  cr: number;
  value: number;
  users: number;
  denominator?: number;
  stats: MetricStats;
}

interface TestResult {
  expected?: number;
  uplift?: {
    dist: string;
    mean?: number;
    stddev?: number;
  };
  ci?: [number, number];
  errorMessage?: string;
  power?: MetricPowerResponseFromStatsEngine;
  // Added later to gbstats model, leave as undefined
  realizedSettings?: RealizedSettings;
}

export interface BayesianTestResult extends TestResult {
  chanceToWin?: number;
  risk?: [number, number];
  riskType?: RiskType;
}

export interface FrequentistTestResult extends TestResult {
  pValue?: number;
  pValueErrorMessage?: PValueErrorMessage;
}

export interface BayesianVariationResponseIndividual
  extends BaselineResponse,
    BayesianTestResult {
  power?: MetricPowerResponseFromStatsEngine;
}

export interface FrequentistVariationResponseIndividual
  extends BaselineResponse,
    FrequentistTestResult {
  power?: MetricPowerResponseFromStatsEngine;
}

type SupplementalResult =
  | BaselineResponse
  | BayesianVariationResponseIndividual
  | FrequentistVariationResponseIndividual;

export interface SupplementalResults {
  cupedUnadjusted?: SupplementalResult;
  uncapped?: SupplementalResult;
  unstratified?: SupplementalResult;
  noVarianceReduction?: SupplementalResult;
  flatPrior?: SupplementalResult;
}

interface BaselineResponseWithSupplementalResults extends BaselineResponse {
  supplementalResults?: SupplementalResults;
}

interface BayesianVariationResponse
  extends BayesianVariationResponseIndividual {
  supplementalResults?: SupplementalResults;
}

interface FrequentistVariationResponse
  extends FrequentistVariationResponseIndividual {
  supplementalResults?: SupplementalResults;
}

// Keep in sync with gbstats PowerResponse
export interface MetricPowerResponseFromStatsEngine {
  status: string;
  errorMessage?: string;
  firstPeriodPairwiseSampleSize?: number;
  targetMDE: number;
  sigmahat2Delta?: number;
  priorProper?: boolean;
  priorLiftMean?: number;
  priorLiftVariance?: number;
  upperBoundAchieved?: boolean;
  scalingFactor?: number;
}

interface BaseDimensionResponse {
  dimension: string;
  srm: number;
}

interface BayesianDimensionResponse extends BaseDimensionResponse {
  variations: (
    | BaselineResponseWithSupplementalResults
    | BayesianVariationResponse
  )[];
}

interface FrequentistDimensionResponse extends BaseDimensionResponse {
  variations: (
    | BaselineResponseWithSupplementalResults
    | FrequentistVariationResponse
  )[];
}

type StatsEngineDimensionResponse =
  | BayesianDimensionResponse
  | FrequentistDimensionResponse;

export type RealizedSettings = {
  postStratificationApplied: boolean;
};

export type ExperimentMetricAnalysis = {
  metric: string;
  analyses: {
    unknownVariations: string[];
    multipleExposures: number;
    dimensions: StatsEngineDimensionResponse[];
  }[];
}[];

export type SingleVariationResult = {
  users?: number;
  cr?: number;
  ci?: [number, number];
};

/** One contextual slice from gbstats; stored on snapshots as `contextualBanditSnapshot`. */
export type ContextualBanditResponseSnapshot = {
  context: Record<string, unknown>;
  /** Id of the regression-tree leaf this context is routed to. */
  leafId?: number;
  sampleSizePerVariation?: number[] | null;
  /** Per-variation sample (data-only) means; not posterior means. */
  sampleMeans?: number[] | null;
  /** Per-variation sample (data-only) variances; not posterior variances. */
  sampleVariances?: number[] | null;
  updatedWeights?: number[] | null;
  bestArmProbabilities?: number[] | null;
  updateMessage?: string | null;
  error?: string | null;
};

/** `in` lists an attribute's allowed levels; `not in` lists excluded levels. */
export type LeafConditionOperator = "in" | "not in";

/** One per-attribute targeting clause of a regression-tree leaf's condition. */
export type ContextualLeafClause = {
  attribute: string;
  levels: string[];
  operator: LeafConditionOperator;
};

/**
 * One regression-tree leaf's targeting condition: the AND of its per-attribute
 * clauses. There is one entry per leaf (not per observed context).
 */
export type ContextualLeafMapEntry = {
  leafId: number;
  context: ContextualLeafClause[];
};

/** Aggregated per-leaf sample (data-only) statistics. */
export type ContextualLeafStatsEntry = {
  leafId: number;
  sampleSizePerVariation?: number[] | null;
  sampleMeans?: number[] | null;
  sampleVariances?: number[] | null;
};

/**
 * Total within-tree SSE captured at each stage of greedy regression-tree
 * growth: index 0 is the root (before the first split), the next entry is the
 * total SSE after the first split, then after the second split, etc.
 */
export type ContextualSseTrajectoryEntry = {
  /** Number of splits applied so far. 0 = root, before the first split. */
  numSplits: number;
  /** Total SSE summed across every leaf of the tree at this stage. */
  totalSse: number;
};

/** Full contextual bandit output for a decision-metric run (mirrors gbstats `ContextualBanditResult`). */
export type ContextualBanditSnapshot = {
  attributes: string[];
  responses: ContextualBanditResponseSnapshot[];
  leaf_map?: ContextualLeafMapEntry[];
  leaf_stats?: ContextualLeafStatsEntry[];
  sse_trajectory?: ContextualSseTrajectoryEntry[];
};

export type MultipleExperimentMetricAnalysis = {
  id: string;
  results: ExperimentMetricAnalysis;
  banditResult?: BanditResult;
  error?: string;
  traceback?: string;
};

// Keep these interfaces in sync with gbstats
export interface AnalysisSettingsForStatsEngine {
  var_names: string[];
  var_ids: string[];
  weights: number[];
  baseline_index: number;
  dimension: string;
  stats_engine: string;
  p_value_corrected: boolean;
  sequential_testing_enabled: boolean;
  sequential_tuning_parameter: number;
  difference_type: string;
  phase_length_days: number;
  alpha: number;
  max_dimensions: number;
  traffic_percentage: number;
  num_goal_metrics: number;
  num_guardrail_metrics: number;
  one_sided_intervals?: boolean;
  use_covariate_as_response?: boolean;
  post_stratification_enabled?: boolean;
}

export interface BanditSettingsForStatsEngine {
  var_names: string[];
  var_ids: string[];
  historical_weights?: {
    date: Date;
    weights: number[];
    total_users: number;
  }[];
  current_weights: number[];
  reweight: boolean;
  decision_metric: string;
  bandit_weights_seed: number;
  contexts?: string[];
}

export type BusinessMetricTypeForStatsEngine =
  | "goal"
  | "secondary"
  | "guardrail";

export interface MetricSettingsForStatsEngine {
  id: string;
  name: string;
  inverse: boolean;
  statistic_type:
    | "mean"
    | "ratio"
    | "ratio_ra"
    | "mean_ra"
    | "quantile_event"
    | "quantile_unit";
  main_metric_type: "count" | "binomial" | "quantile";
  denominator_metric_type?: "count" | "binomial" | "quantile";
  covariate_metric_type?: "count" | "binomial" | "quantile";
  keep_theta?: boolean;
  quantile_value?: number;
  prior_proper?: boolean;
  prior_mean?: number;
  prior_stddev?: number;
  target_mde: number;
  business_metric_type: BusinessMetricTypeForStatsEngine[];
  compute_uncapped_metric: boolean;
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
  bandit_settings?: BanditSettingsForStatsEngine;
}

export interface ExperimentDataForStatsEngine {
  id: string;
  data: DataForStatsEngine;
}
