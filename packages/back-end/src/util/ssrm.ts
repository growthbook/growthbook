/**
 * TypeScript port of packages/stats/gbstats/ssrm.py
 *
 * Implements the sequential Bayes factor test for Sample Ratio Mismatch (SRM).
 * Each "data point" is an array of integer counts per variation for one time
 * period (e.g. one day), so the full input is a 2-D matrix:
 *   rows = time periods, cols = variations
 *
 * The test accumulates a Bayes factor comparing:
 *   M1: traffic proportions are NOT equal to the null (SRM present)
 *   M0: traffic proportions equal the null (no SRM)
 *
 * The final p-value returned by sequentialPValues is the running minimum of
 * 1/BF, which is a valid anytime p-value (always ≤ alpha iff BF ≥ 1/alpha
 * at any point in the sequence).
 */

import logGamma from "@stdlib/math-base-special-gammaln";
import xlogy from "@stdlib/math-base-special-xlogy";

// ---------------------------------------------------------------------------
// Math helpers
// ---------------------------------------------------------------------------

/** Numerically stable log(sum(exp(vals))). */
function logsumexp(vals: number[]): number {
  const max = Math.max(...vals);
  if (!isFinite(max)) return max;
  return max + Math.log(vals.reduce((s, v) => s + Math.exp(v - max), 0));
}

function arraySum(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0);
}

function addArrays(a: number[], b: number[]): number[] {
  return a.map((v, i) => v + b[i]);
}

// ---------------------------------------------------------------------------
// Core statistical functions
// ---------------------------------------------------------------------------

/**
 * Log posterior-predictive density of observation `n` under a
 * Dirichlet(alpha) prior (Dirichlet-Multinomial marginal likelihood).
 *
 * Equivalent to ssrm.log_posterior_predictive.
 */
function logPosteriorPredictive(n: number[], alpha: number[]): number {
  const sumN = arraySum(n);
  const sumAlpha = arraySum(alpha);
  return (
    logGamma(sumN + 1) -
    arraySum(n.map((ni) => logGamma(ni + 1))) +
    logGamma(sumAlpha) -
    arraySum(alpha.map((ai) => logGamma(ai))) +
    arraySum(n.map((ni, i) => logGamma(alpha[i] + ni))) -
    logGamma(sumAlpha + sumN)
  );
}

/**
 * Log PMF of Multinomial(n, p) evaluated at x.
 *
 * Equivalent to ssrm.multinomiallogpmf.
 */
function multinomialLogPMF(x: number[], n: number, p: number[]): number {
  return (
    logGamma(n + 1) +
    arraySum(x.map((xi, i) => xlogy(xi, p[i]) - logGamma(xi + 1)))
  );
}

// ---------------------------------------------------------------------------
// Accumulator
// ---------------------------------------------------------------------------

interface AccState {
  logMlM1: number;
  logMlM0: number;
  /** Dirichlet posterior alpha for M1 (single-component, or kept for compatibility). */
  posteriorM1: number[];
  /** Fixed null probabilities for M0. */
  posteriorM0: number[];
  // Mixture-model fields (present when slabWeight > 0)
  useMixture?: true;
  slabWeight?: number;
  posteriorM1Spike?: number[];
  posteriorM1Slab?: number[];
}

/** One step of the sequential accumulator. Equivalent to ssrm.accumulator. */
function step(acc: AccState, row: number[]): AccState {
  const rowSum = arraySum(row);
  const logMlM0 =
    rowSum > 0
      ? acc.logMlM0 + multinomialLogPMF(row, rowSum, acc.posteriorM0)
      : acc.logMlM0;

  if (
    acc.useMixture &&
    acc.slabWeight !== undefined &&
    acc.posteriorM1Spike &&
    acc.posteriorM1Slab
  ) {
    const sw = acc.slabWeight;
    const logMlSpike = logPosteriorPredictive(row, acc.posteriorM1Spike);
    const logMlSlab = logPosteriorPredictive(row, acc.posteriorM1Slab);
    const logMlM1Step =
      sw === 1.0
        ? logMlSlab
        : sw === 0.0
          ? logMlSpike
          : logsumexp([
              Math.log(1 - sw) + logMlSpike,
              Math.log(sw) + logMlSlab,
            ]);

    return {
      logMlM1: acc.logMlM1 + logMlM1Step,
      logMlM0,
      posteriorM1: addArrays(acc.posteriorM1, row),
      posteriorM0: acc.posteriorM0,
      useMixture: true,
      slabWeight: sw,
      posteriorM1Spike: addArrays(acc.posteriorM1Spike, row),
      posteriorM1Slab: addArrays(acc.posteriorM1Slab, row),
    };
  }

  // Single-component model
  return {
    logMlM1: acc.logMlM1 + logPosteriorPredictive(row, acc.posteriorM1),
    logMlM0,
    posteriorM1: addArrays(acc.posteriorM1, row),
    posteriorM0: acc.posteriorM0,
  };
}

/** Bayes factor BF = exp(log_M1 - log_M0). Equivalent to ssrm.bayes_factor. */
function bayesFactor(acc: AccState): number {
  return Math.exp(acc.logMlM1 - acc.logMlM0);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface SequentialSrmOptions {
  /** Override the prior mean (defaults to nullProbabilities). */
  dirichletProbability?: number[];
  /**
   * How tightly the prior concentrates around its mean.
   * Higher = stronger prior. Default 10 000 (tight around null).
   */
  dirichletConcentration?: number;
  /**
   * Weight for the slab component in a spike-and-slab mixture prior.
   * 0 = no mixture (default). Must be in [0, 1].
   */
  slabWeight?: number;
  /**
   * Concentration of the slab's Dirichlet prior. Default 1.0 (uniform).
   */
  slabConcentration?: number;
}

/**
 * Compute the sequential p-value after each time period.
 *
 * The p-value at position i is `min(1, 1/BF_1, 1/BF_2, ..., 1/BF_i)` — the
 * running minimum of the inverse Bayes factor — which is a valid anytime
 * p-value.  The final element is the overall p-value for the full data.
 *
 * Equivalent to ssrm.sequential_p_values.
 *
 * @param data           2-D integer matrix: rows = time periods, cols = variations.
 * @param nullProbabilities  Expected traffic fractions, must sum to 1.
 * @param options        Optional prior / mixture settings.
 * @returns Array of p-values, one per time period (same length as data).
 */
export function sequentialPValues(
  data: number[][],
  nullProbabilities: number[],
  {
    dirichletProbability,
    dirichletConcentration = 10000,
    slabWeight = 0.0,
    slabConcentration = 1.0,
  }: SequentialSrmOptions = {},
): number[] {
  if (data.length === 0) return [];

  const priorProbs = dirichletProbability ?? nullProbabilities;
  const dirichletAlpha = priorProbs.map((p) => p * dirichletConcentration);
  const k = nullProbabilities.length;

  let acc: AccState;
  if (slabWeight > 0.0) {
    const slabAlpha: number[] = Array(k).fill(slabConcentration);
    acc = {
      logMlM1: 0,
      logMlM0: 0,
      posteriorM1: [...dirichletAlpha],
      posteriorM0: nullProbabilities,
      useMixture: true,
      slabWeight,
      posteriorM1Spike: [...dirichletAlpha],
      posteriorM1Slab: slabAlpha,
    };
  } else {
    acc = {
      logMlM1: 0,
      logMlM0: 0,
      posteriorM1: [...dirichletAlpha],
      posteriorM0: nullProbabilities,
    };
  }

  // Accumulate Bayes factors row by row, then convert to running-min p-values
  let runMin = 1;
  return data.map((row) => {
    acc = step(acc, row);
    const bf = bayesFactor(acc);
    const inv = bf === 0 ? Infinity : 1 / bf;
    runMin = Math.min(runMin, inv);
    return runMin;
  });
}
