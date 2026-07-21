export interface EffectMomentsResult {
  point_estimate: number;
  standard_error: number;
  pairwise_sample_size: number;
  error_message: string | null;
  post_stratification_applied: boolean;
}

export interface Uplift {
  dist: string;
  mean: number;
  stddev: number;
}

export type ResponseCI = [number | null, number | null];

export interface TestResult {
  expected: number;
  ci: ResponseCI;
  uplift: Uplift;
  errorMessage: string | null;
}

export type RiskType = "absolute" | "relative";

export interface BayesianTestResult extends TestResult {
  chanceToWin: number;
  risk: number[];
  riskType: RiskType;
}

export type PValueErrorMessage =
  | "NUMERICAL_PVALUE_NOT_CONVERGED"
  | "ALPHA_GREATER_THAN_0.5_FOR_SEQUENTIAL_ONE_SIDED_TEST";

export interface PValueResult {
  p_value?: number | null;
  p_value_error_message?: PValueErrorMessage | null;
}

export interface RealizedSettings {
  postStratificationApplied: boolean;
}

export interface SingleVariationResult {
  users: number | null;
  cr: number | null;
  variationVariances: number | null;
  ci: ResponseCI | null;
}

export interface BanditResult {
  singleVariationResults: SingleVariationResult[] | null;
  currentWeights: number[] | null;
  updatedWeights: number[] | null;
  bestArmProbabilities: number[] | null;
  seed: number;
  updateMessage: string | null;
  error: string | null;
  reweight: boolean;
  weightsWereUpdated: boolean;
}

export type Context = Record<string, unknown>;

export interface ContextualBanditResponse {
  context: Context;
  sampleSizePerVariation: number[] | null;
  variationMeans: number[] | null;
  variationVariances: number[] | null;
  updatedWeights: number[] | null;
  bestArmProbabilities: number[] | null;
  updateMessage: string | null;
  error: string | null;
}

/** Per-context observed data (sample moments), as opposed to posterior moments. */
export interface ContextualBanditContextSummary {
  context: Context;
  sampleSizePerVariation: number[] | null;
  sampleMeans: number[] | null;
  sampleVariances: number[] | null;
  updatedWeights: number[] | null;
  bestArmProbabilities: number[] | null;
  updateMessage: string | null;
  error: string | null;
}

/** JSON-serializable mapping from observed context attribute values to tree leaf id. */
export interface ContextualLeafMapEntry {
  context: Record<string, string>;
  leafId: number;
}

/** Container for per-context bandit results. */
export interface ContextualBanditNoTreeResult {
  attributes: string[];
  responses: ContextualBanditResponse[];
}

/** Tree fit output. `leafMap` uses tuple context keys until JSON serialization. */
export interface ContextualBanditResult extends ContextualBanditNoTreeResult {
  responsesContext: ContextualBanditContextSummary[];
  leafMap: unknown;
}

export interface MetricStats {
  users: number;
  count: number;
  stddev: number;
  mean: number;
}

export interface BaselineResponse {
  cr: number;
  value: number;
  users: number;
  denominator: number | null;
  stats: MetricStats;
}

export interface PowerResponse {
  status: string;
  errorMessage: string | null;
  firstPeriodPairwiseSampleSize: number | null;
  targetMDE: number;
  sigmahat2Delta: number | null;
  priorProper: boolean | null;
  priorLiftMean: number | null;
  priorLiftVariance: number | null;
  upperBoundAchieved: boolean | null;
  scalingFactor: number | null;
}

export interface FrequentistTestResult extends TestResult {
  pValue: number | null;
  pValueErrorMessage: PValueErrorMessage | null;
}

export interface BayesianVariationResponseIndividual
  extends BayesianTestResult,
    BaselineResponse {
  realizedSettings: RealizedSettings;
  power: PowerResponse | null;
}

export interface FrequentistVariationResponseIndividual
  extends FrequentistTestResult,
    BaselineResponse {
  realizedSettings: RealizedSettings;
  power?: PowerResponse | null;
}

export type VariationResponseIndividual =
  | BayesianVariationResponseIndividual
  | FrequentistVariationResponseIndividual
  | BaselineResponse;

export interface SupplementalResults {
  cupedUnadjusted?: VariationResponseIndividual | null;
  uncapped?: VariationResponseIndividual | null;
  flatPrior?: VariationResponseIndividual | null;
  unstratified?: VariationResponseIndividual | null;
  noVarianceReduction?: VariationResponseIndividual | null;
}

export interface BayesianVariationResponse
  extends BayesianVariationResponseIndividual {
  supplementalResults?: SupplementalResults | null;
}

export interface FrequentistVariationResponse
  extends FrequentistVariationResponseIndividual {
  supplementalResults?: SupplementalResults | null;
}

export interface BaselineResponseWithSupplementalResults
  extends BaselineResponse {
  supplementalResults?: SupplementalResults | null;
}

export type VariationResponse =
  | BayesianVariationResponse
  | FrequentistVariationResponse
  | BaselineResponseWithSupplementalResults;

export interface DimensionResponseIndividual {
  dimension: string;
  srm: number;
  variations: VariationResponseIndividual[];
}

export interface DimensionResponse {
  dimension: string;
  srm: number;
  variations: VariationResponse[];
}

export interface ExperimentMetricAnalysisResult {
  unknownVariations: string[];
  multipleExposures: number;
  dimensions: DimensionResponse[];
}

export interface ExperimentMetricAnalysis {
  metric: string;
  analyses: ExperimentMetricAnalysisResult[];
}

export interface MultipleExperimentMetricAnalysis {
  id: string;
  results: ExperimentMetricAnalysis[];
  banditResult: BanditResult | null;
  contextualBanditResult: ContextualBanditResult | null;
  error: string | null;
  traceback: string | null;
}
