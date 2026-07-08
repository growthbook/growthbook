import {
  bestArmProbabilitiesGaussHermite,
  thompsonSampler,
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
