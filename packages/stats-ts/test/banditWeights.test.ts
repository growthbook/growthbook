import {
  bestArmProbabilitiesGaussHermite,
  thompsonSampler,
  updateVariationWeights,
  type BanditArmStatistic,
} from "../src/banditWeights";

function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

type Scenario = {
  name: string;
  means: number[];
  sigmas: number[];
};

const comparableScenarios: Scenario[] = [
  { name: "near tie, 3 arms", means: [0, 0.1, 0.2], sigmas: [0.1, 0.1, 0.1] },
  { name: "clear ranking, 3 arms", means: [1, 2, 3], sigmas: [0.5, 0.5, 0.5] },
  { name: "all equal, 3 arms", means: [0, 0, 0], sigmas: [0.2, 0.2, 0.2] },
  {
    name: "5 arms spread out",
    means: [0, 1, 2, 3, 4],
    sigmas: [0.3, 0.3, 0.3, 0.3, 0.3],
  },
  {
    name: "dominant arm, 4 arms",
    means: [0, 0, 0, 5],
    sigmas: [0.4, 0.4, 0.4, 0.4],
  },
];

describe("Gauss-Hermite Thompson weighting", () => {
  const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

  it.each(comparableScenarios)(
    "produces probabilities summing to one on comparable-scale arms ($name)",
    ({ means, sigmas }) => {
      const p = bestArmProbabilitiesGaussHermite(means, sigmas);
      expect(p).toHaveLength(means.length);
      p.forEach((pi) => {
        expect(pi).toBeGreaterThanOrEqual(0);
        expect(pi).toBeLessThanOrEqual(1);
      });
      expect(Math.abs(sum(p) - 1)).toBeLessThan(1e-6);
    },
  );

  it("ranks arms by mean (higher mean => higher best-arm probability)", () => {
    const means = [0, 1, 2];
    const sigmas = [0.3, 0.3, 0.3];
    const p = bestArmProbabilitiesGaussHermite(means, sigmas);
    expect(p[2]).toBeGreaterThan(p[1]);
    expect(p[1]).toBeGreaterThan(p[0]);
  });

  it("honors the inverse flag (lower mean is better)", () => {
    const means = [0, 1, 2];
    const sigmas = [0.3, 0.3, 0.3];
    const p = bestArmProbabilitiesGaussHermite(means, sigmas, true);
    expect(p[0]).toBeGreaterThan(p[1]);
    expect(p[1]).toBeGreaterThan(p[2]);
    expect(Math.abs(sum(p) - 1)).toBeLessThan(1e-6);
  });

  it("stays accurate across randomized comparable-scale scenarios", () => {
    const rng = makeRng(42);
    for (let trial = 0; trial < 200; trial++) {
      const k = 3 + Math.floor(rng() * 4);
      const means = Array.from({ length: k }, () => (rng() - 0.5) * 4);
      const sigmas = Array.from({ length: k }, () => 0.2 + rng() * 0.4);

      const p = bestArmProbabilitiesGaussHermite(means, sigmas);
      p.forEach((pi) => {
        expect(pi).toBeGreaterThanOrEqual(0);
        expect(pi).toBeLessThanOrEqual(1);
      });
      expect(Math.abs(sum(p) - 1)).toBeLessThan(1e-5);
    }
  });

  it("stays within bandit tolerance in the heterogeneous-sigma regime", () => {
    const means = [0, 0.5, 1];
    const sigmas = [0.05, 0.5, 1.5];
    const p = bestArmProbabilitiesGaussHermite(means, sigmas);
    expect(Math.abs(sum(p) - 1)).toBeLessThan(1e-2);
  });

  it("is deterministic across repeated calls", () => {
    const means = [0, 0.2, 0.4];
    const sigmas = [0.25, 0.25, 0.25];
    const first = bestArmProbabilitiesGaussHermite(means, sigmas);
    const second = bestArmProbabilitiesGaussHermite(means, sigmas);
    expect(first).toEqual(second);
  });

  it("drives the approximate thompsonSampler path", () => {
    const means = [0, 1, 2];
    const sigmas = [0.4, 0.4, 0.4];
    expect(thompsonSampler(means, sigmas, false, true)).toEqual(
      bestArmProbabilitiesGaussHermite(means, sigmas, false),
    );
  });
});

describe("updateVariationWeights", () => {
  const arm = (n: number, mean: number, variance = 1): BanditArmStatistic => ({
    n,
    mean,
    variance,
  });
  const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

  it("reweights all arms via Thompson when every arm has enough units", () => {
    const stats = [arm(200, 1), arm(200, 2)];
    const result = updateVariationWeights(stats, [0.5, 0.5]);

    expect(result.updateMessage).toBe("successfully updated");
    expect(result.bestArmProbabilities).not.toBeNull();
    expect(result.updatedWeights[1]).toBeGreaterThan(result.updatedWeights[0]);
    expect(sum(result.updatedWeights)).toBeCloseTo(1, 6);
  });

  it("gives small sample size arms 1/K and splits the rest among large sample size arms", () => {
    // K = 3, one deficient arm (n < 100): L = 1, H = 2.
    const stats = [arm(200, 1), arm(200, 2), arm(30, 1)];
    const result = updateVariationWeights(stats, [1 / 3, 1 / 3, 1 / 3]);

    const w = result.updatedWeights;
    expect(w).toHaveLength(3);
    // Deficient arm receives the fixed 1/K exploration weight.
    expect(w[2]).toBeCloseTo(1 / 3, 6);
    // Healthy arms share the remaining (K - L)/K = 2/3 mass.
    expect(w[0] + w[1]).toBeCloseTo(2 / 3, 6);
    expect(w[1]).toBeGreaterThan(w[0]);
    expect(sum(w)).toBeCloseTo(1, 6);

    // bestArmProbabilities mirrors the weights: deficient arm keeps 1/K, and the
    // qualifying arms' P(best) is scaled by the (K - L)/K = 2/3 remaining mass so
    // the full array sums to 1.
    expect(result.bestArmProbabilities).not.toBeNull();
    expect(result.bestArmProbabilities![0]).toBeGreaterThan(0);
    expect(result.bestArmProbabilities![1]).toBeGreaterThan(0);
    expect(
      result.bestArmProbabilities![0] + result.bestArmProbabilities![1],
    ).toBeCloseTo(2 / 3, 6);
    expect(result.bestArmProbabilities![2]).toBeCloseTo(1 / 3, 6);
    expect(sum(result.bestArmProbabilities!)).toBeCloseTo(1, 6);
    expect(result.updateMessage).toContain("1 of 3 variations");
  });

  it("keeps current weights when fewer than 2 arms have enough units", () => {
    // Only one healthy arm (H = 1 < 2): no reweighting.
    const stats = [arm(30, 1), arm(200, 2)];
    const currentWeights = [0.3, 0.7];
    const result = updateVariationWeights(stats, currentWeights);

    expect(result.updatedWeights).toEqual(currentWeights);
    // Returned array must be a copy, not the same reference.
    expect(result.updatedWeights).not.toBe(currentWeights);
    expect(result.bestArmProbabilities).toBeNull();
    expect(result.updateMessage).toBe(
      "requires at least 2 variations with sufficient units to update weights",
    );
  });

  describe("hierarchical pooling (priorSampleSize > 0)", () => {
    const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

    it("defaults (priorSampleSize = 0) match the no-argument behavior", () => {
      const stats = [arm(200, 1), arm(200, 2), arm(200, 3)];
      const withDefault = updateVariationWeights(
        stats,
        [1, 1, 1].map((x) => x / 3),
      );
      const explicitZero = updateVariationWeights(
        stats,
        [1, 1, 1].map((x) => x / 3),
        false,
        0,
      );
      expect(explicitZero.updatedWeights).toEqual(withDefault.updatedWeights);
    });

    it("shrinks weights toward uniform relative to no pooling", () => {
      const stats = [arm(200, 1), arm(200, 2), arm(200, 3)];
      const initial = [1, 1, 1].map((x) => x / 3);

      const noPool = updateVariationWeights(stats, initial, false, 0);
      const pooled = updateVariationWeights(stats, initial, false, 500);

      // Both still sum to 1 and rank arms the same way.
      expect(sum(pooled.updatedWeights)).toBeCloseTo(1, 6);
      expect(pooled.updatedWeights[2]).toBeGreaterThan(
        pooled.updatedWeights[0],
      );

      // Pooling pulls the best arm's weight down and the worst arm's weight up
      // (flatter => more exploration).
      expect(pooled.updatedWeights[2]).toBeLessThan(noPool.updatedWeights[2]);
      expect(pooled.updatedWeights[0]).toBeGreaterThan(
        noPool.updatedWeights[0],
      );
    });

    it("stronger priors produce flatter weights", () => {
      const stats = [arm(200, 1), arm(200, 3)];
      const initial = [0.5, 0.5];

      const weak = updateVariationWeights(stats, initial, false, 50);
      const strong = updateVariationWeights(stats, initial, false, 2000);

      const spread = (w: number[]): number => Math.abs(w[1] - w[0]);
      expect(spread(strong.updatedWeights)).toBeLessThan(
        spread(weak.updatedWeights),
      );
    });

    it("matches the documented calculation with unequal counts and variances", () => {
      // Mirrors src/banditWeights.ts (not exported from the module).
      const BANDIT_PRIOR_MEAN = 0;
      const BANDIT_PRIOR_PRECISION = 1 / 1e4;
      const MIN_VARIATION_WEIGHT = 0.01;

      // Distinct n AND variance per arm, so each arm's shrinkage and pool
      // precision differ. A bug that reused one arm's shrinkage/pool precision
      // for every arm would change the common mean and posteriors and fail here.
      const stats = [
        arm(300, 1.0, 2.0),
        arm(150, 2.0, 0.5),
        arm(500, 1.5, 4.0),
      ];
      const n0 = 100;
      const initial = [1, 1, 1].map((x) => x / 3);

      // Per-arm quantities from the documented hierarchical-pooling model.
      const dataPrecision = stats.map((s) => s.n / s.variance);
      const shrinkage = stats.map((s) => n0 / (s.n + n0));
      const poolPrecision = stats.map((s) => n0 / s.variance);

      // Guard: this scenario is only meaningful if shrinkage really differs.
      expect(shrinkage[0]).not.toBeCloseTo(shrinkage[1], 6);
      expect(shrinkage[1]).not.toBeCloseTo(shrinkage[2], 6);

      // Common-mean posterior: precision-weighted (by dataPrecision * shrinkage)
      // plus the diffuse hyperprior.
      let muNumerator = BANDIT_PRIOR_PRECISION * BANDIT_PRIOR_MEAN;
      let muDenominator = BANDIT_PRIOR_PRECISION;
      stats.forEach((s, i) => {
        const w = dataPrecision[i] * shrinkage[i];
        muNumerator += w * s.mean;
        muDenominator += w;
      });
      const commonMean = muNumerator / muDenominator;
      const commonMeanVariance = 1 / muDenominator;

      // Per-arm posterior mean (shrunk toward the common mean) and std (arm
      // precision plus the inherited common-mean uncertainty).
      const expectedMean = stats.map(
        (s, i) => (1 - shrinkage[i]) * s.mean + shrinkage[i] * commonMean,
      );
      const expectedStd = stats.map((_, i) => {
        const armVariance = 1 / (dataPrecision[i] + poolPrecision[i]);
        return Math.sqrt(armVariance + shrinkage[i] ** 2 * commonMeanVariance);
      });

      // thompsonWeightsForSubset uses the approximate (Gauss-Hermite) sampler.
      const expectedProbs = bestArmProbabilitiesGaussHermite(
        expectedMean,
        expectedStd,
        false,
      );
      // Weights: floor each probability at MIN_VARIATION_WEIGHT, then renormalize.
      // All three arms clear the unit threshold, so remainingMass = 1.
      const clamped = expectedProbs.map((p) =>
        Math.max(p, MIN_VARIATION_WEIGHT),
      );
      const clampSum = clamped.reduce((a, b) => a + b, 0);
      const expectedWeights = clamped.map((p) => p / clampSum);

      const result = updateVariationWeights(stats, initial, false, n0);

      expect(result.bestArmProbabilities).not.toBeNull();
      result.bestArmProbabilities!.forEach((p, i) => {
        expect(p).toBeCloseTo(expectedProbs[i], 6);
      });
      result.updatedWeights.forEach((w, i) => {
        expect(w).toBeCloseTo(expectedWeights[i], 6);
      });
      expect(sum(result.updatedWeights)).toBeCloseTo(1, 6);
    });
  });
});
