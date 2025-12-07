export { StatsEngine } from "back-end/src/models/ProjectModel";

import { BanditResult } from "shared/validators";
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

interface BaseExperimentResults {
  expected?: number;
  uplift?: {
    dist: string;
    mean?: number;
    stddev?: number;
  };
  ci?: [number | null, number | null];
  errorMessage?: string;
}

interface BayesianExperimentResults extends BaseExperimentResults {
  chanceToWin?: number;
  risk?: [number, number];
  riskType?: RiskType;
}

interface FrequentistExperimentResults extends BaseExperimentResults {
  pValue?: number;
  pValueErrorMessage?: PValueErrorMessage;
}

interface BayesianVariationResponse
  extends BaselineResponse,
    BayesianExperimentResults {
  power?: MetricPowerResponseFromStatsEngine;
  supplementalResultsCupedUnadjusted?: BayesianExperimentResults;
  supplementalResultsUncapped?: BayesianExperimentResults;
  supplementalResultsUnstratified?: BayesianExperimentResults;
  supplementalResultsFlatPrior?: BayesianExperimentResults;
}

interface FrequentistVariationResponse
  extends BaselineResponse,
    FrequentistExperimentResults {
  power?: MetricPowerResponseFromStatsEngine;
  supplementalResultsCupedUnadjusted?: FrequentistExperimentResults;
  supplementalResultsUncapped?: FrequentistExperimentResults;
  supplementalResultsUnstratified?: FrequentistExperimentResults;
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
