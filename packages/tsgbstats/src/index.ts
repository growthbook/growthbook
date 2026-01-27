// Main exports for tsgbstats

// Models - Statistics
export {
  Statistic,
  SampleMeanStatistic,
  ProportionStatistic,
  RatioStatistic,
  RegressionAdjustedStatistic,
  RegressionAdjustedRatioStatistic,
  QuantileStatistic,
  computeTheta,
  computeCovariance,
  sumStats,
} from "./models/statistics";

// Models - Results
export {
  Uplift,
  TestResult,
  BayesianTestResult,
  FrequentistTestResult,
  EffectMomentsResult,
} from "./models/results";

// Models - Settings
export {
  DifferenceType,
  BaseConfig,
  FrequentistConfig,
  SequentialConfig,
  BayesianConfig,
  EffectBayesianConfig,
  GaussianPrior,
} from "./models/settings";

// Frequentist Tests
export {
  TwoSidedTTest,
  OneSidedTreatmentGreaterTTest,
  OneSidedTreatmentLesserTTest,
  SequentialTwoSidedTTest,
  SequentialOneSidedTreatmentGreaterTTest,
  SequentialOneSidedTreatmentLesserTTest,
} from "./frequentist/tests";

// Bayesian Tests
export { EffectBayesianABTest } from "./bayesian/tests";

// Post-Stratification
export {
  EffectMomentsPostStratification,
  EffectMoments,
  PostStratificationSummary,
  PostStratificationSummaryRatio,
  StrataResultCount,
  StrataResultRatio,
  EffectMomentsConfig,
  ZERO_NEGATIVE_VARIANCE_MESSAGE,
  BASELINE_VARIATION_ZERO_MESSAGE,
  multinomialCovariance as postStratMultinomialCovariance,
} from "./frequentist/postStratification";

// Utilities
export {
  frequentistDiff,
  frequentistVariance,
  varianceOfRatios,
  truncatedNormalMean,
  gaussianCredibleInterval,
  checkSrm,
  multinomialCovariance,
} from "./utils";

export { getCupedUnadjustedStat } from "./utils/cupedUnadjusted";

export { testPostStratEligible } from "./utils/postStratEligible";

// Power Analysis
export {
  MidExperimentPower,
  MidExperimentPowerConfig,
  MidExperimentPowerResult,
} from "./power/midexperimentpower";

// High-Level API
export {
  detectUnknownVariations,
  getMetricDfs,
  reduceDimensionality,
  analyzeMetricDf,
  processAnalysis,
  processSingleMetric,
  variationStatisticFromMetricRow,
  baseStatisticFromMetricRow,
  getVarIdMap,
  getDimensionColumnName,
  type MetricStats,
  type ResponseCI,
  type BaselineResponse,
  type BaseVariationResponse,
  type BayesianVariationResponseIndividual,
  type FrequentistVariationResponseIndividual,
  type VariationResponseIndividual,
  type SupplementalResults,
  type BayesianVariationResponse,
  type FrequentistVariationResponse,
  type BaselineResponseWithSupplementalResults,
  type VariationResponse,
  type DimensionResponse,
  type DimensionMetricData,
  type ExperimentMetricAnalysis,
  type ExperimentMetricAnalysisResult,
  type RealizedSettings,
} from "./gbstats";

// High-Level API Settings
export {
  type AnalysisSettingsForStatsEngine,
  type MetricSettingsForStatsEngine,
  type BanditSettingsForStatsEngine,
  type VarIdMap,
  type MetricType,
  type StatisticType,
  type StatsEngine,
  DEFAULT_ANALYSIS_SETTINGS,
  DEFAULT_METRIC_SETTINGS,
} from "./models/settings";
