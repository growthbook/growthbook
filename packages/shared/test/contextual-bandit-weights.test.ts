import type { ContextualBanditResponseSnapshot } from "shared/types/stats";
import {
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

  it("weights contexts uniformly when no users are recorded", () => {
    const responses = [
      response({ updatedWeights: [1, 0] }),
      response({ updatedWeights: [0, 1] }),
    ];
    const result = computeOverallVariationWeights(responses, 2);
    expect(result[0]).toBeCloseTo(0.5, 10);
    expect(result[1]).toBeCloseTo(0.5, 10);
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
