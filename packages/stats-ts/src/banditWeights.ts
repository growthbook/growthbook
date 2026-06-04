/**
 * Core Gaussian-Gaussian Thompson weighting for bandit variation weights.
 *
 * `updateVariationWeights` takes the per-variation bandit statistics for one
 * unit of data and returns updated traffic weights. In the contextual case the
 * caller invokes it once per regression-tree leaf (passing that leaf's
 * aggregated arm statistics); in the (not-yet-ported) non-contextual case it
 * would be invoked once over all of the experiment's data. The algorithm
 * mirrors gbstats `Bandits.compute_result` + `get_bandit_result`: posterior
 * moments, best-arm (Thompson) sampling, min-weight clamp + renormalize, and
 * the >=100-units gate.
 *
 * Best-arm probabilities use Monte Carlo draws here, matching Python's approach
 * (so weights are numerically close to, but not bit-identical with, the Python
 * output).
 */
import { randomNormal } from "./utils";

// gbstats bandit prior: GaussianPrior(mean=0, variance=1e4, proper=True).
const BANDIT_PRIOR_MEAN = 0;
const BANDIT_PRIOR_VARIANCE = 1e4;
const BANDIT_PRIOR_PRECISION = 1 / BANDIT_PRIOR_VARIANCE;
// gbstats BanditConfig.min_variation_weight.
const MIN_VARIATION_WEIGHT = 0.01;
// gbstats Bandits.compute_result enough_units gate.
const MIN_UNITS_PER_VARIATION = 100;

/** Per-variation statistics needed to update bandit weights. */
export type BanditArmStatistic = {
  n: number;
  mean: number;
  variance: number;
};

export type VariationWeightResult = {
  updatedWeights: number[];
  bestArmProbabilities: number[] | null;
  updateMessage: string;
  error: string;
};

interface IntegrateResult {
  value: number;
  error: number;
}

function adaptiveSimpsons(
  f: (x: number) => number,
  a: number,
  b: number,
  tol: number = 1e-8,
  maxDepth: number = 50,
): IntegrateResult {
  function simpson(f: (x: number) => number, a: number, b: number): number {
    const m = (a + b) / 2;
    return ((b - a) / 6) * (f(a) + 4 * f(m) + f(b));
  }

  function recurse(
    a: number,
    b: number,
    tol: number,
    whole: number,
    depth: number,
  ): number {
    const m = (a + b) / 2;
    const left = simpson(f, a, m);
    const right = simpson(f, m, b);
    const delta = left + right - whole;

    if (depth >= maxDepth) return left + right; // give up, return best estimate

    // Richardson extrapolation error estimate
    if (Math.abs(delta) <= 15 * tol) {
      return left + right + delta / 15;
    }

    return (
      recurse(a, m, tol / 2, left, depth + 1) +
      recurse(m, b, tol / 2, right, depth + 1)
    );
  }

  const whole = simpson(f, a, b);
  const value = recurse(a, b, tol, whole, 0);

  return { value, error: tol };
}

// Normal PDF and CDF helpers
function normalPdf(x: number, mean: number, sd: number): number {
  const z = (x - mean) / sd;
  return Math.exp(-0.5 * z * z) / (sd * Math.sqrt(2 * Math.PI));
}

function normalCdf(x: number, mean: number, sd: number): number {
  return 0.5 * (1 + erf((x - mean) / (sd * Math.SQRT2)));
}

function erf(x: number): number {
  // Abramowitz & Stegun approximation, max error 1.5e-7
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const p =
    t *
    (0.254829592 +
      t *
        (-0.284496736 +
          t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const v = 1 - p * Math.exp(-x * x);
  return x >= 0 ? v : -v;
}

// Main function: probability that arm k has the largest mean
function probKthArmIsBiggest(
  means: number[],
  sds: number[],
  k: number, // 0-indexed
): IntegrateResult {
  const integrand = (x: number): number => {
    const pdfK = normalPdf(x, means[k], sds[k]);

    // Sum log-CDFs for numerical stability when K is large
    let logProd = 0;
    for (let i = 0; i < means.length; i++) {
      if (i !== k) {
        logProd += Math.log(normalCdf(x, means[i], sds[i]));
      }
    }

    return pdfK * Math.exp(logProd);
  };

  // Integrate over +/- 7 sigma around the spread of means for safety
  const allMeans = means;
  const centre = means[k];
  const spread =
    Math.max(...sds) * 7 +
    Math.max(...allMeans.map((m, i) => Math.abs(m - centre) + sds[i]));

  return adaptiveSimpsons(integrand, centre - spread, centre + spread);
}

/**
 * P(arm i has the largest value) for independent Normal(mean_i, std_i^2) arms
 * (or the smallest, when `inverse`). When `useApproximate` is true, the
 * probabilities are computed via deterministic adaptive Simpson's quadrature
 * over the closed-form best-arm integral; otherwise they are estimated via
 * Monte Carlo (Thompson) sampling.
 */
export function thompsonSampler(
  means: number[],
  sigmas: number[],
  inverse: boolean = false,
  useApproximate: boolean = false,
): number[] {
  if (useApproximate) {
    // P(arm k is smallest) == P(arm k is largest) with all means negated.
    const adjMeans = inverse ? means.map((m) => -m) : means;
    return means.map((_, k) => probKthArmIsBiggest(adjMeans, sigmas, k).value);
  }

  const K = means.length;
  const wins = new Array(K).fill(0);
  const nSamples = 1e7;

  for (let i = 0; i < nSamples; i++) {
    let extremeVal = inverse ? Infinity : -Infinity;
    let extremeIdx = 0;

    for (let k = 0; k < K; k++) {
      const sample = randomNormal(1, means[k], sigmas[k])[0];
      if (inverse ? sample < extremeVal : sample > extremeVal) {
        extremeVal = sample;
        extremeIdx = k;
      }
    }
    wins[extremeIdx]++;
  }

  return wins.map((w) => w / nSamples);
}

/**
 * Update bandit variation weights from per-variation statistics.
 *
 * Operates on a single leaf's aggregated arm statistics (contextual case) or on
 * all of the experiment's arm statistics (non-contextual case); the algorithm
 * is identical. When any variation has fewer than 100 units no update is made
 * and the current weights are returned unchanged.
 */
export function updateVariationWeights(
  stats: BanditArmStatistic[],
  currentWeights: number[],
  inverse: boolean = false,
): VariationWeightResult {
  const counts = stats.map((s) => s.n);
  const enoughUnits = counts.every((n) => n >= MIN_UNITS_PER_VARIATION);
  if (!enoughUnits) {
    return {
      updatedWeights: currentWeights.slice(),
      bestArmProbabilities: null,
      updateMessage: "total sample size must be at least 100 per variation",
      error: "",
    };
  }

  const dataPrecision = stats.map((s) =>
    s.variance > 0 ? s.n / s.variance : 0,
  );
  const posteriorVariance = dataPrecision.map(
    (dp) => 1 / (BANDIT_PRIOR_PRECISION + dp),
  );
  const posteriorMean = posteriorVariance.map(
    (pv, i) =>
      pv *
      (BANDIT_PRIOR_PRECISION * BANDIT_PRIOR_MEAN +
        dataPrecision[i] * stats[i].mean),
  );
  const posteriorStd = posteriorVariance.map((pv) => Math.sqrt(pv));

  const bestArmProbabilities = thompsonSampler(
    posteriorMean,
    posteriorStd,
    inverse,
    true,
  );

  const clamped = bestArmProbabilities.map((p) =>
    p < MIN_VARIATION_WEIGHT ? MIN_VARIATION_WEIGHT : p,
  );
  const sum = clamped.reduce((a, b) => a + b, 0) || 1;
  const updatedWeights = clamped.map((p) => p / sum);

  return {
    updatedWeights,
    bestArmProbabilities,
    updateMessage: "successfully updated",
    error: "",
  };
}
