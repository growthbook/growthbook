import type { MetricStats } from "./metric";

export type StatsEngine = "bayesian" | "frequentist";

export type PValueCorrection = null | "benjamini-hochberg" | "holm-bonferroni";

export type DifferenceType = "relative" | "absolute" | "scaled";

interface BaseVariationResponse {
  cr: number;
  value: number;
  users: number;
  denominator?: number;
  stats: MetricStats;
  expected?: number;
  uplift?: {
    dist: string;
    mean?: number;
    stddev?: number;
  };
  ci?: [number, number];
  errorMessage?: string;
}

interface BayesianVariationResponse extends BaseVariationResponse {
  chanceToWin?: number;
  risk?: [number, number];
}

interface FrequentistVariationResponse extends BaseVariationResponse {
  pValue?: number;
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

// Keep ExperimentMetricAnalysis and children classes in sync with gbstats
export type ExperimentMetricAnalysis = {
  metric: string;
  analyses: {
    unknownVariations: string[];
    multipleExposures: number;
    dimensions: StatsEngineDimensionResponse[];
  }[];
}[];
