/**
 * Result classes for A/B test analysis.
 * TypeScript port of gbstats/models/results.py
 */

export type RiskType = "relative" | "absolute";

/**
 * Uplift distribution representation.
 */
export interface Uplift {
  dist: string;
  mean: number;
  stddev: number;
}

/**
 * Effect moments result (internal).
 */
export interface EffectMomentsResult {
  pointEstimate: number;
  standardError: number;
  pairwiseSampleSize: number;
  errorMessage: string | null;
  postStratificationApplied: boolean;
}

/**
 * Base test result.
 */
export interface TestResult {
  expected: number;
  ci: [number, number];
  uplift: Uplift;
  errorMessage: string | null;
}

/**
 * Bayesian test result.
 */
export interface BayesianTestResult extends TestResult {
  chanceToWin: number;
  risk: [number, number];
  riskType: RiskType;
}

/**
 * P-value error message types.
 */
export type PValueErrorMessage =
  | "NUMERICAL_PVALUE_NOT_CONVERGED"
  | "ALPHA_GREATER_THAN_0.5_FOR_SEQUENTIAL_ONE_SIDED_TEST"
  | null;

/**
 * Frequentist test result.
 */
export interface FrequentistTestResult extends TestResult {
  pValue: number | null;
  pValueErrorMessage?: PValueErrorMessage;
}

/**
 * Create a default uninformative frequentist result.
 */
export function defaultFrequentistResult(
  errorMessage: string | null = null,
  pValueErrorMessage: PValueErrorMessage = null,
): FrequentistTestResult {
  return {
    expected: 0,
    ci: [0, 0],
    uplift: { dist: "normal", mean: 0, stddev: 0 },
    errorMessage,
    pValue: 1,
    pValueErrorMessage,
  };
}

/**
 * Create a default uninformative Bayesian result.
 */
export function defaultBayesianResult(
  errorMessage: string | null = null,
  relative: boolean = true,
): BayesianTestResult {
  return {
    expected: 0,
    ci: [0, 0],
    uplift: { dist: "normal", mean: 0, stddev: 0 },
    errorMessage,
    chanceToWin: 0.5,
    risk: [0, 0],
    riskType: relative ? "relative" : "absolute",
  };
}
