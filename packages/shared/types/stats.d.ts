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

export type RiskType = "relative" | "absolute";

export type PValueErrorMessage =
  | "NUMERICAL_PVALUE_NOT_CONVERGED"
  | "ALPHA_GREATER_THAN_0.5_FOR_SEQUENTIAL_ONE_SIDED_TEST";

interface BaselineResponse {
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
  ci?: [number | null, number | null];
  errorMessage?: string;
}

interface BayesianTestResult extends TestResult {
  chanceToWin?: number;
  risk?: [number, number];
  riskType?: RiskType;
}

interface FrequentistTestResult extends TestResult {
  pValue?: number;
  pValueErrorMessage?: PValueErrorMessage;
}

interface BayesianVariationResponse
  extends BaselineResponse,
    BayesianTestResult {
  power?: MetricPowerResponseFromStatsEngine;
  supplementalResultsCupedUnadjusted?: BayesianTestResult;
  supplementalResultsUncapped?: BayesianTestResult;
  supplementalResultsUnstratified?: BayesianTestResult;
  supplementalResultsFlatPrior?: BayesianTestResult;
}

interface FrequentistVariationResponse
  extends BaselineResponse,
    FrequentistTestResult {
  power?: MetricPowerResponseFromStatsEngine;
  supplementalResultsCupedUnadjusted?: FrequentistTestResult;
  supplementalResultsUncapped?: FrequentistTestResult;
  supplementalResultsUnstratified?: FrequentistTestResult;
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
  variations: BayesianVariationResponse[];
}

interface FrequentistVariationResponse extends BaseDimensionResponse {
  variations: FrequentistVariationResponse[];
}

type StatsEngineDimensionResponse =
  | BayesianDimensionResponse
  | FrequentistVariationResponse;

// Keep below classes in sync with gbstats
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
  one_sided_intervals?: boolean;
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
  capped: boolean;
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
