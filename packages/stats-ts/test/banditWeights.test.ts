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
    // K = 3, one deficient arm (n < 50): L = 1, H = 2.
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

    // Best-arm probabilities are reported for healthy arms and null (unavailable)
    // for the deficient arm, so it is not misread as a computed 0% chance.
    expect(result.bestArmProbabilities).not.toBeNull();
    expect(result.bestArmProbabilities![0]).toBeGreaterThan(0);
    expect(result.bestArmProbabilities![1]).toBeGreaterThan(0);
    expect(result.bestArmProbabilities![2]).toBeNull();
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
});
