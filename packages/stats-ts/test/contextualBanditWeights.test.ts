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

  it("falls back to the analysis weights when an arm has < 100 units", () => {
    const data = [countryObs("US", 0, 50, 1), countryObs("US", 1, 50, 2)];

    const result = computeContextualBanditWeights(input(data));
    const r = result.responses[0];
    expect(r.updatedWeights).toEqual([0.5, 0.5]);
    expect(r.bestArmProbabilities).toBeNull();
    expect(r.updateMessage).toBe(
      "total sample size must be at least 100 per variation",
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
