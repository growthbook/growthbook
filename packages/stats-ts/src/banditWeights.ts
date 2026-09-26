import {
  MIN_UNITS_PER_VARIATION,
  MIN_UNITS_PER_VARIATION_LEAF_GRANULARITY,
} from "shared/constants";
import { normCdf, randomNormal } from "./utils";

const BANDIT_PRIOR_MEAN = 0;
const BANDIT_PRIOR_VARIANCE = 1e4;
const BANDIT_PRIOR_PRECISION = 1 / BANDIT_PRIOR_VARIANCE;
const MIN_VARIATION_WEIGHT = 0.01;
export { MIN_UNITS_PER_VARIATION, MIN_UNITS_PER_VARIATION_LEAF_GRANULARITY };
// Minimum variance for a bandit variation.
const BANDIT_MIN_VARIANCE = 1e-9;

export type BanditArmStatistic = {
  n: number;
  mean: number;
  variance: number;
};

export type VariationWeightResult = {
  updatedWeights: number[];
  // Per-variation P(best) among arms with sample size >= 100, otherwise the uniform prior 1/K.
  bestArmProbabilities: number[] | null;
  updateMessage: string;
  error: string;
};

function logProdOtherCdfs(
  x: number,
  means: number[],
  sds: number[],
  k: number,
): number {
  let logProd = 0;
  for (let i = 0; i < means.length; i++) {
    if (i !== k) {
      const cdf = normCdf(x, means[i], sds[i]);
      logProd += Math.log(cdf > 0 ? cdf : Number.MIN_VALUE);
    }
  }
  return logProd;
}

const GAUSS_HERMITE_ORDER = 128;

interface GaussHermiteRule {
  nodes: number[];
  weights: number[];
}

let gaussHermiteRuleCache: GaussHermiteRule | null = null;

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

function getGaussHermiteRule(n: number): GaussHermiteRule {
  if (gaussHermiteRuleCache && gaussHermiteRuleCache.nodes.length === n) {
    return gaussHermiteRuleCache;
  }

  const d = new Array<number>(n).fill(0);
  const e = new Array<number>(n).fill(0);
  for (let i = 0; i < n - 1; i++) {
    e[i] = Math.sqrt((i + 1) / 2);
  }

  const z = new Array<number>(n).fill(0);
  z[0] = 1;

  symmetricTridiagonalQL(d, e, z);

  const mu0 = Math.sqrt(Math.PI);
  gaussHermiteRuleCache = {
    nodes: d.slice(),
    weights: z.map((zi) => mu0 * zi * zi),
  };
  return gaussHermiteRuleCache;
}

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

type SubsetThompsonResult = {
  // Normalized Thompson weights over the subset (sum to 1), each floored at
  // MIN_VARIATION_WEIGHT then renormalized.
  weights: number[];
  // Raw best-arm probabilities over the subset (pre-floor).
  bestArmProbabilities: number[];
};

/**
 * Compute Thompson weights for the subset of arms identified by `indices`.
 */
function thompsonWeightsForSubset(
  stats: BanditArmStatistic[],
  indices: number[],
  inverse: boolean,
): SubsetThompsonResult {
  const subset = indices.map((i) => stats[i]);

  const dataPrecision = subset.map(
    (s) => s.n / Math.max(s.variance, BANDIT_MIN_VARIANCE),
  );
  const posteriorVariance = dataPrecision.map(
    (dp) => 1 / (BANDIT_PRIOR_PRECISION + dp),
  );
  const posteriorMean = posteriorVariance.map(
    (pv, i) =>
      pv *
      (BANDIT_PRIOR_PRECISION * BANDIT_PRIOR_MEAN +
        dataPrecision[i] * subset[i].mean),
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
  const weights = clamped.map((p) => p / sum);

  return { weights, bestArmProbabilities };
}

export function updateVariationWeights(
  stats: BanditArmStatistic[],
  currentWeights: number[],
  inverse: boolean = false,
): VariationWeightResult {
  const numStats = stats.length;
  const statsWithEnoughUsers: number[] = [];
  const statsWithoutEnoughUsers: number[] = [];
  stats.forEach((s, i) => {
    if (s.n >= MIN_UNITS_PER_VARIATION_LEAF_GRANULARITY) {
      statsWithEnoughUsers.push(i);
    } else {
      statsWithoutEnoughUsers.push(i);
    }
  });
  const numWithoutEnoughUsers = statsWithoutEnoughUsers.length;

  // Thompson allocation requires at least two comparable arms.
  if (statsWithEnoughUsers.length < 2) {
    return {
      updatedWeights: currentWeights.slice(),
      bestArmProbabilities: null,
      updateMessage:
        "requires at least 2 variations with sufficient units to update weights",
      error: "",
    };
  }

  const { weights: subsetWeights, bestArmProbabilities: subsetProbs } =
    thompsonWeightsForSubset(stats, statsWithEnoughUsers, inverse);

  // Mass reserved for the variations that have enough users. The remaining
  // variations each keep the fixed 1 / numStats exploration weight set below.
  const remainingMass = (numStats - numWithoutEnoughUsers) / numStats;

  const updatedWeights = new Array<number>(numStats).fill(1 / numStats);
  // Per-variation P(best) among arms with sample size >= 100, otherwise the uniform prior 1/K.
  const bestArmProbabilities = new Array<number>(numStats).fill(1 / numStats);
  statsWithEnoughUsers.forEach((idx, j) => {
    updatedWeights[idx] = subsetWeights[j] * remainingMass;
    bestArmProbabilities[idx] = subsetProbs[j];
  });

  const updateMessage =
    numWithoutEnoughUsers === 0
      ? "successfully updated"
      : `successfully updated; ${numWithoutEnoughUsers} of ${numStats} variations below ${MIN_UNITS_PER_VARIATION_LEAF_GRANULARITY} units assigned uniform weight`;

  return {
    updatedWeights,
    bestArmProbabilities,
    updateMessage,
    error: "",
  };
}
