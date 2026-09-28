import type { ContextualBanditResponseSnapshot } from "shared/types/stats";
import {
  computeOverallVariationMeans,
  computeOverallVariationWeights,
  contextTotalSampleSize,
} from "../src/experiments/contextual-bandit-weights";

function response(
  overrides: Partial<ContextualBanditResponseSnapshot>,
): ContextualBanditResponseSnapshot {
  return { context: {}, ...overrides };
}

describe("contextTotalSampleSize", () => {
  it("sums per-variation sample sizes, treating nullish as 0", () => {
    expect(
      contextTotalSampleSize(
        response({ sampleSizePerVariation: [10, 20, null] }),
      ),
    ).toBe(30);
  });

  it("returns 0 when there are no sample sizes", () => {
    expect(contextTotalSampleSize(response({}))).toBe(0);
    expect(
      contextTotalSampleSize(response({ sampleSizePerVariation: [] })),
    ).toBe(0);
  });
});

describe("computeOverallVariationWeights", () => {
  it("returns nulls when there are no responses", () => {
    expect(computeOverallVariationWeights([], 2)).toEqual([null, null]);
  });

  it("returns an empty array when there are no variations", () => {
    expect(
      computeOverallVariationWeights([response({ updatedWeights: [1] })], 0),
    ).toEqual([]);
  });

  it("weights contexts by their share of total users", () => {
    const responses = [
      response({
        sampleSizePerVariation: [75, 75],
        updatedWeights: [0.8, 0.2],
      }),
      response({
        sampleSizePerVariation: [25, 25],
        updatedWeights: [0.4, 0.6],
      }),
    ];
    const result = computeOverallVariationWeights(responses, 2);
    expect(result[0]).toBeCloseTo(0.7, 10);
    expect(result[1]).toBeCloseTo(0.3, 10);
  });

  it("throws when a context is missing updatedWeights (no best-arm fallback)", () => {
    expect(() =>
      computeOverallVariationWeights(
        [
          response({
            sampleSizePerVariation: [10, 10],
            bestArmProbabilities: [0.9, 0.1],
          }),
        ],
        2,
      ),
    ).toThrow(/updatedWeights/);
  });

  it("returns nulls when no per-context sample sizes are recorded", () => {
    const responses = [
      response({ updatedWeights: [1, 0] }),
      response({ updatedWeights: [0, 1] }),
    ];
    expect(computeOverallVariationWeights(responses, 2)).toEqual([null, null]);
  });

  it("returns null for variations no context contributed a weight to", () => {
    const result = computeOverallVariationWeights(
      [response({ sampleSizePerVariation: [10, 10], updatedWeights: [0.5] })],
      2,
    );
    expect(result[0]).toBeCloseTo(0.5, 10);
    expect(result[1]).toBeNull();
  });
});

describe("computeOverallVariationMeans", () => {
  it("returns nulls when there are no responses", () => {
    expect(computeOverallVariationMeans([], 2)).toEqual([null, null]);
  });

  it("weights each context's mean by its total population share", () => {
    // Context A has 3x the population of context B, so its mean dominates.
    const responses = [
      response({ sampleSizePerVariation: [60, 90], sampleMeans: [10, 20] }),
      response({ sampleSizePerVariation: [30, 20], sampleMeans: [2, 4] }),
    ];
    // v0: (150*10 + 50*2) / 200 = 8; v1: (150*20 + 50*4) / 200 = 16
    const result = computeOverallVariationMeans(responses, 2);
    expect(result[0]).toBeCloseTo(8, 10);
    expect(result[1]).toBeCloseTo(16, 10);
  });

  it("weights each context by the same population total for every variation", () => {
    // A variation with lopsided per-variation sample sizes still uses the
    // context's total population share, not its own arm size.
    const responses = [
      response({ sampleSizePerVariation: [1, 99], sampleMeans: [10, 0] }),
      response({ sampleSizePerVariation: [99, 1], sampleMeans: [0, 10] }),
    ];
    // Both contexts have population 100, so weights are 0.5 each.
    // v0: 0.5*10 + 0.5*0 = 5; v1: 0.5*0 + 0.5*10 = 5.
    const result = computeOverallVariationMeans(responses, 2);
    expect(result[0]).toBeCloseTo(5, 10);
    expect(result[1]).toBeCloseTo(5, 10);
  });

  it("skips contexts where a variation has no recorded mean and renormalizes", () => {
    const responses = [
      response({ sampleSizePerVariation: [10, 10], sampleMeans: [4, null] }),
      response({ sampleSizePerVariation: [30, 30], sampleMeans: [8, 6] }),
    ];
    // v0 uses both contexts: (20*4 + 60*8) / 80 = 7.
    // v1 only has a mean in the second context, so it equals 6.
    const result = computeOverallVariationMeans(responses, 2);
    expect(result[0]).toBeCloseTo(7, 10);
    expect(result[1]).toBeCloseTo(6, 10);
  });

  it("returns nulls when no per-context sample sizes are recorded", () => {
    const responses = [
      response({ sampleMeans: [10, 2] }),
      response({ sampleMeans: [20, 4] }),
    ];
    expect(computeOverallVariationMeans(responses, 2)).toEqual([null, null]);
  });

  it("returns null for variations no context contributed a mean to", () => {
    const result = computeOverallVariationMeans(
      [response({ sampleSizePerVariation: [10, 10], sampleMeans: [5] })],
      2,
    );
    expect(result[0]).toBeCloseTo(5, 10);
    expect(result[1]).toBeNull();
  });
});
