import type { MetricStats } from "./metric";

export type StatsEngine = "bayesian" | "frequentist";

interface BaseDiffStats {
  dist: string;
  mean: number;
  stddev: number;
  expected: number;
  ci: [number, number];
}

interface RelativeDiffStats extends BaseDiffStats {
  DiffType: "relative";
}

interface AbsoluteDiffStats extends BaseDiffStats {
  DiffType: "absolute";
}

interface BayesianDiffStats {
  chanceToWin: number;
  risk: [number, number];
}

interface FrequentistDiffStats {
  pValue: number;
}

type BayesianRelativeDiffStats = RelativeDiffStats & BayesianDiffStats;

type FrequentistRelativeDiffStats = RelativeDiffStats & FrequentistDiffStats;

type BayesianAbsoluteDiffStats = AbsoluteDiffStats & BayesianDiffStats;

type FrequentistAbsoluteDiffStats = AbsoluteDiffStats & FrequentistDiffStats;

export interface VariationResponse {
  cr: number;
  value: number;
  users: number;
  denominator?: number;
  stats: MetricStats;
  relativeDiffStats: BayesianRelativeDiffStats | FrequentistRelativeDiffStats;
  absoluteDiffStats: BayesianAbsoluteDiffStats | FrequentistAbsoluteDiffStats;
}

interface StatsEngineDimensionResponse {
  dimension: string;
  srm: number;
  variations: VariationResponse[];
}

export interface ExperimentMetricAnalysis {
  unknownVariations: string[];
  multipleExposures: number;
  dimensions: StatsEngineDimensionResponse[];
}
