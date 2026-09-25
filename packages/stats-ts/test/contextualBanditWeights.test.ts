import type { MetricSettingsForStatsEngine } from "shared/types/stats";
import {
  computeContextualBanditWeights,
  type ContextualBanditArm,
  type ContextualBanditObservation,
  ContextualBanditWeightsInput,
} from "../src/contextualBanditWeights";

const ZERO_ARM: ContextualBanditArm = {
  n: 0,
  main_sum: 0,
  main_sum_squares: 0,
  denominator_sum: 0,
  denominator_sum_squares: 0,
  main_denominator_sum_product: 0,
  covariate_sum: 0,
  covariate_sum_squares: 0,
  main_covariate_sum_product: 0,
};

function observation(
  context: Record<string, string>,
  variationIndex: number,
  arm: Partial<ContextualBanditArm>,
): ContextualBanditObservation {
  return { variationIndex, context, arm: { ...ZERO_ARM, ...arm } };
}

/** `n` units of a count metric with the given mean and variance. */
function countObs(
  context: Record<string, string>,
  variationIndex: number,
  n: number,
  mean: number,
  sigma2 = 1,
): ContextualBanditObservation {
  return observation(context, variationIndex, {
    n,
    main_sum: mean * n,
    main_sum_squares: mean * mean * n + (n - 1) * sigma2,
  });
}

/** Country-only context, the shape most of these tests use. */
function countryObs(
  country: string,
  variationIndex: number,
  n: number,
  mean: number,
  sigma2 = 1,
): ContextualBanditObservation {
  return countObs({ country }, variationIndex, n, mean, sigma2);
}

function meanMetric(inverse = false): MetricSettingsForStatsEngine {
  return {
    id: "met_1",
    name: "Decision",
    statistic_type: "mean",
    main_metric_type: "count",
    inverse,
    keep_theta: false,
    target_mde: 0.01,
    business_metric_type: ["goal"],
    compute_uncapped_metric: false,
  } as unknown as MetricSettingsForStatsEngine;
}

function input(
  observations: ContextualBanditObservation[],
  inverse = false,
): ContextualBanditWeightsInput {
  return {
    varIds: ["v0", "v1"],
    attributes: ["country"],
    maxLeaves: 8,
    minUsersPerLeaf: 1,
    metricSettings: meanMetric(inverse),
    analysisWeights: [0.5, 0.5],
    observations,
  };
}

describe("computeContextualBanditWeights", () => {
  it("returns an empty result when there are no observations", () => {
    const result = computeContextualBanditWeights(input([]));
    expect(result).toEqual({
      attributes: ["country"],
      responses: [],
      leaf_map: [],
    });
  });

  it("weights the better-performing arm more heavily (single context)", () => {
    const data = [countryObs("US", 0, 200, 1), countryObs("US", 1, 200, 2)];

    const result = computeContextualBanditWeights(input(data));

    expect(result.responses).toHaveLength(1);
    const r = result.responses[0];
    expect(r.context).toEqual({ country: "US" });
    expect(r.sampleSizePerVariation).toEqual([200, 200]);
    expect(r.sampleMeans).toEqual([1, 2]);
    expect(r.updateMessage).toBe("successfully updated");

    const weights = r.updatedWeights as number[];
    expect(weights[1]).toBeGreaterThan(weights[0]);
    expect(weights[0]).toBeGreaterThan(0);
    expect(weights[0]).toBeLessThan(0.02);
    expect(weights.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
  });

  it("sums observations that share a context and variation", () => {
    const data = [
      countryObs("US", 0, 100, 1),
      countryObs("US", 0, 100, 1),
      countryObs("US", 1, 200, 2),
    ];

    const result = computeContextualBanditWeights(input(data));

    expect(result.responses).toHaveLength(1);
    expect(result.responses[0].sampleSizePerVariation).toEqual([200, 200]);
  });

  it("honors the inverse flag (lower mean is better)", () => {
    const data = [countryObs("US", 0, 200, 1), countryObs("US", 1, 200, 2)];

    const result = computeContextualBanditWeights(input(data, true));
    const weights = result.responses[0].updatedWeights as number[];
    expect(weights[0]).toBeGreaterThan(weights[1]);
  });

  it("keeps the analysis weights when fewer than 2 arms have enough units", () => {
    // Both arms are below the leaf threshold, so H = 0 < 2 and we cannot reweight.
    const data = [countryObs("US", 0, 30, 1), countryObs("US", 1, 30, 2)];

    const result = computeContextualBanditWeights(input(data));
    const r = result.responses[0];
    expect(r.updatedWeights).toEqual([0.5, 0.5]);
    expect(r.bestArmProbabilities).toBeNull();
    expect(r.updateMessage).toBe(
      "requires at least 2 variations with sufficient units to update weights",
    );
  });

  it("assigns 1/K to deficient arms and splits the rest among healthy arms", () => {
    // v0 and v1 are healthy (H = 2), v2 is deficient (< 50 units), so v2 gets a
    // fixed 1/K weight and v0/v1 share the remaining (K - L)/K = 2/3 mass.
    const data = [
      countryObs("US", 0, 200, 1),
      countryObs("US", 1, 200, 2),
      countryObs("US", 2, 30, 1),
    ];

    const result = computeContextualBanditWeights({
      ...input(data),
      varIds: ["v0", "v1", "v2"],
      analysisWeights: [1 / 3, 1 / 3, 1 / 3],
    });

    const r = result.responses[0];
    const w = r.updatedWeights as number[];
    expect(w).toHaveLength(3);
    expect(w[2]).toBeCloseTo(1 / 3, 6);
    expect(w[0] + w[1]).toBeCloseTo(2 / 3, 6);
    expect(w[1]).toBeGreaterThan(w[0]);
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    expect(r.updateMessage).toContain("1 of 3 variations");

    // The deficient arm's P(best) is the uniform prior 1/K (K = 3), not a
    // computed 0, while the healthy arms report real probabilities scaled by the
    // remaining mass. The array stays fully numeric for API back-compat and sums
    // to 1.
    const probs = r.bestArmProbabilities as number[];
    expect(probs[0]).toBeGreaterThan(0);
    expect(probs[1]).toBeGreaterThan(0);
    expect(probs[2]).toBeCloseTo(1 / 3, 6);
    expect(probs.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
  });

  it("excludes under-powered variations from tree building", () => {
    // v0 and v1 are healthy but carry no country signal (identical US/CA means),
    // so on their own the tree has no reason to split. v2 has a strong country
    // signal but is under-powered (< 100 units), so it must not drive a split.
    // v2 has 30 + 30 = 60 total units, below the 100-unit threshold.
    const data = [
      countryObs("US", 0, 200, 1),
      countryObs("US", 1, 200, 2),
      countryObs("US", 2, 30, 1),
      countryObs("CA", 0, 200, 1),
      countryObs("CA", 1, 200, 2),
      countryObs("CA", 2, 30, 9),
    ];

    const result = computeContextualBanditWeights({
      ...input(data),
      varIds: ["v0", "v1", "v2"],
      analysisWeights: [1 / 3, 1 / 3, 1 / 3],
    });

    // A single leaf: the under-powered v2's country signal was ignored.
    expect(result.leaf_map).toHaveLength(1);
    expect(new Set(result.responses.map((r) => r.leafId)).size).toBe(1);
  });

  it("lets a sufficiently-powered variation drive a tree split", () => {
    // Same shape as the previous test, but v2 now has enough units, so its
    // strong country signal splits US from CA. This confirms the previous test's
    // single leaf was caused by v2's low unit count, not the data shape.
    const data = [
      countryObs("US", 0, 200, 1),
      countryObs("US", 1, 200, 2),
      countryObs("US", 2, 200, 1),
      countryObs("CA", 0, 200, 1),
      countryObs("CA", 1, 200, 2),
      countryObs("CA", 2, 200, 9),
    ];

    const result = computeContextualBanditWeights({
      ...input(data),
      varIds: ["v0", "v1", "v2"],
      analysisWeights: [1 / 3, 1 / 3, 1 / 3],
    });

    expect(result.leaf_map!.length).toBeGreaterThan(1);
    expect(new Set(result.responses.map((r) => r.leafId)).size).toBeGreaterThan(
      1,
    );
  });

  it("keeps one leaf and the analysis weights when no variation is powered enough", () => {
    // Tree building only considers variations with >= MIN_UNITS_PER_VARIATION
    // (100) total units. Every variation here is far below that, so none is
    // eligible to drive a split and all contexts collapse into a single (root)
    // leaf -- even though US and CA carry opposing signals that would otherwise
    // split them apart. The pooled per-variation units at that leaf (40 each)
    // are also below the 50-unit leaf-granularity threshold, so fewer than 2
    // arms qualify and the weights fall back to the analysis weights unchanged.
    const data = [
      countryObs("US", 0, 20, 1),
      countryObs("US", 1, 20, 2),
      countryObs("CA", 0, 20, 2),
      countryObs("CA", 1, 20, 1),
    ];

    const result = computeContextualBanditWeights(input(data));

    // Both contexts map to the same single leaf.
    expect(result.leaf_map).toHaveLength(1);
    expect(result.responses).toHaveLength(2);
    expect(new Set(result.responses.map((r) => r.leafId)).size).toBe(1);

    // No reweighting: every context keeps the analysis weights.
    for (const r of result.responses) {
      expect(r.updatedWeights).toEqual([0.5, 0.5]);
      expect(r.bestArmProbabilities).toBeNull();
      expect(r.updateMessage).toBe(
        "requires at least 2 variations with sufficient units to update weights",
      );
    }
  });

  it("produces the same single-leaf, no-update result when only one variation has enough units", () => {
    // v0 now clears the 50-unit leaf threshold (60 pooled units) while v1 stays
    // below it (30 units), and neither reaches the 100-unit tree threshold. With
    // only one qualifying arm (H = 1 < 2) the weights still cannot update, and
    // with no tree-eligible variation the contexts stay in one leaf -- the same
    // result as when no variation had enough units.
    const data = [
      countryObs("US", 0, 30, 1),
      countryObs("US", 1, 15, 2),
      countryObs("CA", 0, 30, 2),
      countryObs("CA", 1, 15, 1),
    ];

    const result = computeContextualBanditWeights(input(data));

    expect(result.leaf_map).toHaveLength(1);
    expect(result.responses).toHaveLength(2);
    expect(new Set(result.responses.map((r) => r.leafId)).size).toBe(1);

    for (const r of result.responses) {
      expect(r.updatedWeights).toEqual([0.5, 0.5]);
      expect(r.bestArmProbabilities).toBeNull();
      expect(r.updateMessage).toBe(
        "requires at least 2 variations with sufficient units to update weights",
      );
    }
  });

  it("keeps one leaf but still reweights when pooled units clear the 50-unit leaf threshold", () => {
    // Boundary case between the two tests above: every variation is still below
    // the 100-unit tree threshold (60 pooled units each), so the contexts stay
    // in a single leaf. But those 60 pooled units clear the 50-unit leaf
    // threshold for both arms (H = 2), so Thompson reweighting DOES run and the
    // better-performing arm (v1) is weighted more heavily.
    const data = [
      countryObs("US", 0, 30, 1),
      countryObs("US", 1, 30, 2),
      countryObs("CA", 0, 30, 1),
      countryObs("CA", 1, 30, 2),
    ];

    const result = computeContextualBanditWeights(input(data));

    // Single leaf: no variation was powered enough to split.
    expect(result.leaf_map).toHaveLength(1);
    expect(result.responses).toHaveLength(2);
    expect(new Set(result.responses.map((r) => r.leafId)).size).toBe(1);

    // Weights were updated (not the fallback), identically for every context.
    for (const r of result.responses) {
      expect(r.updateMessage).toBe("successfully updated");
      expect(r.bestArmProbabilities).not.toBeNull();
      const w = r.updatedWeights as number[];
      expect(w[1]).toBeGreaterThan(w[0]);
      expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    }
    expect(result.responses[0].updatedWeights).toEqual(
      result.responses[1].updatedWeights,
    );
  });

  it("splits differing contexts into separate leaves with distinct weights", () => {
    const data = [
      countryObs("US", 0, 200, 1),
      countryObs("US", 1, 200, 2),
      countryObs("CA", 0, 200, 2),
      countryObs("CA", 1, 200, 1),
    ];

    const result = computeContextualBanditWeights(input(data));

    expect(result.responses).toHaveLength(2);
    const leafIds = result.leaf_map!.map((e) => e.leafId);
    expect(new Set(leafIds).size).toBe(2);

    const us = result.responses.find(
      (r) => (r.context as { country: string }).country === "US",
    )!;
    const ca = result.responses.find(
      (r) => (r.context as { country: string }).country === "CA",
    )!;
    const usW = us.updatedWeights as number[];
    const caW = ca.updatedWeights as number[];
    expect(usW[1]).toBeGreaterThan(usW[0]);
    expect(caW[0]).toBeGreaterThan(caW[1]);
  });

  it("groups observations with no value for an attribute separately", () => {
    // An absent attribute value belongs to the catch-all bucket, which must not
    // be pooled with a context that has a value, and must be reported as having
    // no value rather than as the bucket's placeholder.
    const data = [
      countryObs("US", 0, 200, 1),
      countryObs("US", 1, 200, 2),
      countObs({}, 0, 200, 2),
      countObs({}, 1, 200, 1),
    ];

    const result = computeContextualBanditWeights(input(data));

    expect(result.responses).toHaveLength(2);
    const contexts = result.responses.map((r) => r.context);
    expect(contexts).toContainEqual({ country: "US" });
    expect(contexts).toContainEqual({});
  });

  it("ignores context attributes that are not part of the analysis", () => {
    // `device` is not in `attributes`, so it neither splits the two
    // observations into separate contexts nor shows up in the reported context.
    const data = [
      countObs({ country: "US", device: "mobile" }, 0, 200, 1),
      countObs({ country: "US", device: "desktop" }, 1, 200, 2),
    ];

    const result = computeContextualBanditWeights(input(data));

    expect(result.responses).toHaveLength(1);
    expect(result.responses[0].context).toEqual({ country: "US" });
  });

  it("splits categories via k-means", () => {
    const data = [
      countryObs("US", 0, 200, 1),
      countryObs("US", 1, 200, 2),
      countryObs("CA", 0, 200, 2),
      countryObs("CA", 1, 200, 1),
    ];

    // Two categories => a 2-cluster k-means split separates them deterministically.
    const result = computeContextualBanditWeights(input(data));

    expect(result.responses).toHaveLength(2);
    const leafIds = result.leaf_map!.map((e) => e.leafId);
    expect(new Set(leafIds).size).toBe(2);

    const us = result.responses.find(
      (r) => (r.context as { country: string }).country === "US",
    )!;
    const ca = result.responses.find(
      (r) => (r.context as { country: string }).country === "CA",
    )!;
    const usW = us.updatedWeights as number[];
    const caW = ca.updatedWeights as number[];
    expect(usW[1]).toBeGreaterThan(usW[0]);
    expect(caW[0]).toBeGreaterThan(caW[1]);
  });

  it("omits attributes the tree never split on from leaf conditions", () => {
    // country is strongly predictive (US favors v1, CA favors v0); device is
    // uninformative (identical means), so the tree splits on country only.
    const data = [
      countObs({ country: "US", device: "mobile" }, 0, 200, 1),
      countObs({ country: "US", device: "mobile" }, 1, 200, 3),
      countObs({ country: "US", device: "desktop" }, 0, 200, 1),
      countObs({ country: "US", device: "desktop" }, 1, 200, 3),
      countObs({ country: "CA", device: "mobile" }, 0, 200, 3),
      countObs({ country: "CA", device: "mobile" }, 1, 200, 1),
      countObs({ country: "CA", device: "desktop" }, 0, 200, 3),
      countObs({ country: "CA", device: "desktop" }, 1, 200, 1),
    ];

    const result = computeContextualBanditWeights({
      ...input(data),
      attributes: ["country", "device"],
    });

    const leafMap = result.leaf_map!;
    // One leaf per country; device was never split, so no device clause anywhere.
    expect(leafMap).toHaveLength(2);
    for (const entry of leafMap) {
      expect(entry.context.map((c) => c.attribute)).toEqual(["country"]);
    }
    const countryLevels = leafMap
      .flatMap((e) => e.context)
      .flatMap((c) => c.levels)
      .sort();
    expect(countryLevels).toEqual(["CA", "US"]);
  });

  it("records the total-SSE trajectory across splits (root then after each split)", () => {
    const data = [
      countryObs("US", 0, 200, 1),
      countryObs("US", 1, 200, 2),
      countryObs("CA", 0, 200, 2),
      countryObs("CA", 1, 200, 1),
    ];

    const result = computeContextualBanditWeights(input(data));

    expect(result.sse_trajectory).toBeDefined();
    expect(result.sse_trajectory!.map((s) => s.numSplits)).toEqual([0, 1]);

    expect(result.sse_trajectory![0].totalSse).toBeCloseTo(996, 6);
    expect(result.sse_trajectory![1].totalSse).toBeCloseTo(796, 6);

    expect(result.sse_trajectory![1].totalSse).toBeLessThan(
      result.sse_trajectory![0].totalSse,
    );
  });

  it("records split metadata for the first (root) split", () => {
    const data = [
      countryObs("US", 0, 200, 1),
      countryObs("US", 1, 200, 2),
      countryObs("CA", 0, 200, 2),
      countryObs("CA", 1, 200, 1),
    ];

    const result = computeContextualBanditWeights(input(data));

    expect(result.sse_trajectory!.map((s) => s.numSplits)).toEqual([0, 1]);
    // The root has no split; the first split has an empty leaf condition
    // because it operates on the (unconstrained) root node.
    expect(result.sse_trajectory![0].split).toBeUndefined();
    const split = result.sse_trajectory![1].split!;
    expect(split).toBeDefined();
    expect(split.attribute).toBe("country");
    expect(split.leafClauses).toEqual([]);
    // The two sides partition the root node's two countries.
    expect([...split.leftLevels, ...split.rightLevels].sort()).toEqual([
      "CA",
      "US",
    ]);
    expect(split.leftLevels).toHaveLength(1);
    expect(split.rightLevels).toHaveLength(1);
  });

  it("records the pre-split leaf condition for a deeper split", () => {
    // Three clearly distinct countries force two splits (three leaves): the
    // root split, then a split of the leaf holding the two grouped countries.
    const data = [
      countryObs("US", 0, 200, 1),
      countryObs("US", 1, 200, 10),
      countryObs("CA", 0, 200, 10),
      countryObs("CA", 1, 200, 1),
      countryObs("MX", 0, 200, 5),
      countryObs("MX", 1, 200, 5),
    ];

    const result = computeContextualBanditWeights(input(data));

    expect(result.sse_trajectory!.map((s) => s.numSplits)).toEqual([0, 1, 2]);
    expect(result.sse_trajectory![0].split).toBeUndefined();

    const rootSplit = result.sse_trajectory![1].split!;
    expect(rootSplit.attribute).toBe("country");
    expect(rootSplit.leafClauses).toEqual([]);
    expect([...rootSplit.leftLevels, ...rootSplit.rightLevels].sort()).toEqual([
      "CA",
      "MX",
      "US",
    ]);

    const deepSplit = result.sse_trajectory![2].split!;
    expect(deepSplit.attribute).toBe("country");
    // The node split second is already constrained by the root split, so its
    // leaf condition names exactly the two countries it still contains.
    const nodeLevels = [
      ...deepSplit.leftLevels,
      ...deepSplit.rightLevels,
    ].sort();
    expect(nodeLevels).toHaveLength(2);
    expect(deepSplit.leafClauses).toHaveLength(1);
    expect(deepSplit.leafClauses[0].attribute).toBe("country");
    expect(deepSplit.leafClauses[0].operator).toBe("in");
    expect(deepSplit.leafClauses[0].levels.slice().sort()).toEqual(nodeLevels);
  });

  it("returns a single root entry in the SSE trajectory when no split helps", () => {
    const data = [countryObs("US", 0, 200, 1), countryObs("US", 1, 200, 2)];

    const result = computeContextualBanditWeights(input(data));

    expect(result.sse_trajectory!.map((s) => s.numSplits)).toEqual([0]);
    expect(result.sse_trajectory![0].totalSse).toBeCloseTo(398, 6);
  });

  it("records a non-negative total SSE at each stage", () => {
    const data = [
      countryObs("US", 0, 200, 1),
      countryObs("US", 1, 200, 2),
      countryObs("CA", 0, 200, 2),
      countryObs("CA", 1, 200, 1),
    ];

    const result = computeContextualBanditWeights(input(data));

    expect(result.sse_trajectory!.length).toBeGreaterThan(0);
    for (const step of result.sse_trajectory!) {
      expect(step.totalSse).toBeGreaterThanOrEqual(0);
    }
  });

  it("computes a BIC statistic per split from the per-variation SSE trajectory", () => {
    const data = [
      countryObs("US", 0, 200, 1),
      countryObs("US", 1, 200, 2),
      countryObs("CA", 0, 200, 2),
      countryObs("CA", 1, 200, 1),
    ];

    const result = computeContextualBanditWeights(input(data));

    // One BIC entry per split (the transition between consecutive stages),
    // aligned to the resulting stage's numSplits.
    expect(result.bic_trajectory).toBeDefined();
    expect(result.bic_trajectory!.map((b) => b.numSplits)).toEqual([1]);

    const bic = result.bic_trajectory![0];
    // The split reduces SSE, so the likelihood ratio is positive.
    expect(bic.logLikelihoodRatio).toBeGreaterThan(0);
    // K = 2 variations, N = 800 total users => penalty = 2 * ln(800).
    expect(bic.penalty).toBeCloseTo(2 * Math.log(800), 6);
    expect(bic.deltaBic).toBeCloseTo(bic.penalty - bic.logLikelihoodRatio, 6);
  });

  it("produces no BIC entries when the tree does not split", () => {
    const data = [countryObs("US", 0, 200, 1), countryObs("US", 1, 200, 2)];

    const result = computeContextualBanditWeights(input(data));

    expect(result.bic_trajectory).toEqual([]);
  });

  it("keeps identical contexts in a single leaf", () => {
    const data = [
      countryObs("US", 0, 200, 1),
      countryObs("US", 1, 200, 2),
      countryObs("CA", 0, 200, 1),
      countryObs("CA", 1, 200, 2),
    ];

    const result = computeContextualBanditWeights(input(data));

    expect(result.responses).toHaveLength(2);
    const leafIds = result.leaf_map!.map((e) => e.leafId);
    expect(new Set(leafIds).size).toBe(1);

    const [a, b] = result.responses;
    expect(a.updatedWeights).toEqual(b.updatedWeights);
  });

  it("produces stable weights across runs (within Monte Carlo noise)", () => {
    const data = [countryObs("US", 0, 200, 1), countryObs("US", 1, 200, 1.2)];
    const first = computeContextualBanditWeights(input(data));
    const second = computeContextualBanditWeights(input(data));
    const w1 = first.responses[0].updatedWeights as number[];
    const w2 = second.responses[0].updatedWeights as number[];
    expect(w1).toHaveLength(w2.length);
    w1.forEach((w, i) => {
      expect(Math.abs(w - w2[i])).toBeLessThan(0.02);
    });
  });

  it("accepts binomial (proportion) decision metrics", () => {
    const data = [
      observation({ country: "US" }, 0, { n: 200, main_sum: 40 }),
      observation({ country: "US" }, 1, { n: 200, main_sum: 120 }),
    ];
    const settings = input(data);
    settings.metricSettings = {
      ...settings.metricSettings,
      main_metric_type: "binomial",
    };
    const result = computeContextualBanditWeights(settings);
    const r = result.responses[0];
    // Higher-converting arm (v1) should be weighted more heavily.
    const [w0, w1] = r.updatedWeights as number[];
    expect(w1).toBeGreaterThan(w0);
  });

  it.each([
    { statistic_type: "ratio" as const },
    { statistic_type: "ratio_ra" as const },
    { statistic_type: "mean_ra" as const },
    { statistic_type: "quantile_event" as const },
  ])(
    "rejects unsupported statistic_type $statistic_type",
    ({ statistic_type }) => {
      const data = [countryObs("US", 0, 200, 1), countryObs("US", 1, 200, 2)];
      const settings = input(data);
      settings.metricSettings = { ...settings.metricSettings, statistic_type };
      expect(() => computeContextualBanditWeights(settings)).toThrow(
        /only count \(sample mean\) and binomial \(proportion\) metrics/,
      );
    },
  );

  it("rejects unsupported main_metric_type (quantile)", () => {
    const data = [countryObs("US", 0, 200, 1), countryObs("US", 1, 200, 2)];
    const settings = input(data);
    settings.metricSettings = {
      ...settings.metricSettings,
      main_metric_type: "quantile",
    };
    expect(() => computeContextualBanditWeights(settings)).toThrow(
      /only count \(sample mean\) and binomial \(proportion\) metrics/,
    );
  });
});
