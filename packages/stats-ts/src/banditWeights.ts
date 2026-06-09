/** Gaussian-Gaussian Thompson weighting for bandit variation weights. */
import { randomNormal } from "./utils";

const BANDIT_PRIOR_MEAN = 0;
const BANDIT_PRIOR_VARIANCE = 1e4;
const BANDIT_PRIOR_PRECISION = 1 / BANDIT_PRIOR_VARIANCE;
const MIN_VARIATION_WEIGHT = 0.01;
const MIN_UNITS_PER_VARIATION = 100;

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

/**
 * Sum of log Φ over the non-k arms.
 *
 * Guards against CDF underflow: the `erf` approximation can return a value that
 * is exactly 0 (or, within its ~1.5e-7 error, slightly negative) for arguments
 * deep in the lower tail. The Gauss-Hermite nodes reach far into the tails, so
 * clamp to the smallest positive double before taking the log to avoid
 * `-Infinity`/`NaN`.
 */
function logProdOtherCdfs(
  x: number,
  means: number[],
  sds: number[],
  k: number,
): number {
  let logProd = 0;
  for (let i = 0; i < means.length; i++) {
    if (i !== k) {
      const cdf = normalCdf(x, means[i], sds[i]);
      logProd += Math.log(cdf > 0 ? cdf : Number.MIN_VALUE);
    }
  }
  return logProd;
}

// 128 nodes is far more than the comparable-scale posteriors (the realistic
// regime, where per-arm stds are similar thanks to the >=100-units floor) need,
// and buys headroom for the harder case where one arm's CDF is a near-step on
// another arm's scale. The rule is computed once and memoized.
const GAUSS_HERMITE_ORDER = 128;

interface GaussHermiteRule {
  nodes: number[];
  weights: number[];
}

let gaussHermiteRuleCache: GaussHermiteRule | null = null;

/**
 * Symmetric tridiagonal QL with implicit shifts (Numerical Recipes `tqli`),
 * specialized to track only the first row of the eigenvector matrix.
 *
 * `d` holds the diagonal (overwritten with the eigenvalues), `e` the
 * subdiagonal where `e[i]` couples `d[i]` and `d[i+1]` (`e[n-1]` unused), and
 * `z` is initialized to the first row of the identity and ends up holding the
 * first component of each eigenvector. That first component is all the
 * Golub-Welsch algorithm needs to recover Gauss quadrature weights.
 */
function symmetricTridiagonalQL(d: number[], e: number[], z: number[]): void {
  const n = d.length;
  const sign = (a: number, b: number): number =>
    b >= 0 ? Math.abs(a) : -Math.abs(a);

  for (let l = 0; l < n; l++) {
    let iter = 0;
    let m = l;
    do {
      for (m = l; m < n - 1; m++) {
        const dd = Math.abs(d[m]) + Math.abs(d[m + 1]);
        if (Math.abs(e[m]) <= Number.EPSILON * dd) break;
      }
      if (m !== l) {
        if (iter++ === 50) {
          throw new Error("Gauss-Hermite QL iteration did not converge");
        }
        let g = (d[l + 1] - d[l]) / (2 * e[l]);
        let r = Math.hypot(g, 1);
        g = d[m] - d[l] + e[l] / (g + sign(r, g));
        let s = 1;
        let c = 1;
        let p = 0;
        let i = m - 1;
        for (; i >= l; i--) {
          let f = s * e[i];
          const b = c * e[i];
          r = Math.hypot(f, g);
          e[i + 1] = r;
          if (r === 0) {
            d[i + 1] -= p;
            e[m] = 0;
            break;
          }
          s = f / r;
          c = g / r;
          g = d[i + 1] - p;
          r = (d[i] - g) * s + 2 * c * b;
          p = s * r;
          d[i + 1] = g + p;
          g = c * r - b;
          // Accumulate only the first row of the eigenvector matrix.
          f = z[i + 1];
          z[i + 1] = s * z[i] + c * f;
          z[i] = c * z[i] - s * f;
        }
        if (r === 0 && i >= l) continue;
        d[l] -= p;
        e[l] = g;
        e[m] = 0;
      }
    } while (m !== l);
  }
}

/**
 * Gauss-Hermite nodes/weights for the weight function e^{-x^2} via the
 * Golub-Welsch algorithm: the nodes are the eigenvalues of the symmetric
 * tridiagonal Jacobi matrix for (physicists') Hermite polynomials, and each
 * weight is sqrt(pi) times the squared first component of the matching
 * eigenvector. Computed once and memoized for the fixed order.
 */
function getGaussHermiteRule(n: number): GaussHermiteRule {
  if (gaussHermiteRuleCache && gaussHermiteRuleCache.nodes.length === n) {
    return gaussHermiteRuleCache;
  }

  const d = new Array<number>(n).fill(0);
  const e = new Array<number>(n).fill(0);
  // Off-diagonal Jacobi entries beta_i = sqrt(i / 2), i = 1..n-1.
  for (let i = 0; i < n - 1; i++) {
    e[i] = Math.sqrt((i + 1) / 2);
  }

  const z = new Array<number>(n).fill(0);
  z[0] = 1;

  symmetricTridiagonalQL(d, e, z);

  const mu0 = Math.sqrt(Math.PI); // integral of e^{-x^2} over R
  gaussHermiteRuleCache = {
    nodes: d.slice(),
    weights: z.map((zi) => mu0 * zi * zi),
  };
  return gaussHermiteRuleCache;
}

/**
 * P(arm k has the largest mean) via Gauss-Hermite quadrature.
 *
 * The integrand already carries arm k's Gaussian PDF, which is exactly the
 * e^{-x^2} weight function after the substitution x = mu_k + sqrt(2)*sigma_k*u:
 *
 *   P(k biggest) = (1 / sqrt(pi)) * sum_j w_j * prod_{i != k} Phi((x_j-mu_i)/sd_i)
 *
 * The remaining product of Gaussian CDFs is smooth and bounded in [0, 1], so a
 * modest fixed node count converges well past the precision the 0.01 weight
 * floor needs, with a predictable, recursion-free cost.
 */
function probKthArmIsBiggestGaussHermite(
  means: number[],
  sds: number[],
  k: number,
): number {
  const { nodes, weights } = getGaussHermiteRule(GAUSS_HERMITE_ORDER);
  const scale = Math.SQRT2 * sds[k];
  let sum = 0;
  for (let j = 0; j < nodes.length; j++) {
    const x = means[k] + scale * nodes[j];
    sum += weights[j] * Math.exp(logProdOtherCdfs(x, means, sds, k));
  }
  return sum / Math.sqrt(Math.PI);
}

/** P(each arm is best) via Gauss-Hermite quadrature. */
export function bestArmProbabilitiesGaussHermite(
  means: number[],
  sigmas: number[],
  inverse: boolean = false,
): number[] {
  // P(arm k is smallest) == P(arm k is largest) with all means negated.
  const adjMeans = inverse ? means.map((m) => -m) : means;
  return means.map((_, k) =>
    probKthArmIsBiggestGaussHermite(adjMeans, sigmas, k),
  );
}

/** P(arm i is largest/smallest); deterministic Gauss-Hermite when useApproximate, else Monte Carlo. */
export function thompsonSampler(
  means: number[],
  sigmas: number[],
  inverse: boolean = false,
  useApproximate: boolean = false,
): number[] {
  if (useApproximate) {
    return bestArmProbabilitiesGaussHermite(means, sigmas, inverse);
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

/** Update bandit variation weights from per-variation statistics (one leaf or all data). */
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
