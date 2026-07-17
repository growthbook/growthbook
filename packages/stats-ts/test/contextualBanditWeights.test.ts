import type { ExperimentMetricQueryResponseRows } from "shared/types/integrations";
import { contextualBanditAttrCol } from "shared/experiments";
import type { MetricSettingsForStatsEngine } from "shared/types/stats";
import {
  computeContextualBanditWeights,
  ContextualBanditWeightsInput,
} from "../src/contextualBanditWeights";

const ATTR_COL = contextualBanditAttrCol("country");

function rows(
  data: Record<string, string | number>[],
): ExperimentMetricQueryResponseRows {
  return data as unknown as ExperimentMetricQueryResponseRows;
}

function countRow(
  country: string,
  variation: string,
  n: number,
  mean: number,
  sigma2 = 1,
): Record<string, string | number> {
  const sum = mean * n;
  const sumSquares = (mean * mean * n + (n - 1) * sigma2) as number;
  return {
    [ATTR_COL]: country,
    variation,
    count: n,
    main_sum: sum,
    main_sum_squares: sumSquares,
  };
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
  data: ExperimentMetricQueryResponseRows,
  inverse = false,
): ContextualBanditWeightsInput {
  return {
    varIds: ["v0", "v1"],
    attributes: ["country"],
    maxLeaves: 8,
    minUsersPerLeaf: 1,
    metricSettings: meanMetric(inverse),
    analysisWeights: [0.5, 0.5],
    rows: data,
  };
}

describe("computeContextualBanditWeights", () => {
  it("returns an empty result when there are no rows", () => {
    const result = computeContextualBanditWeights(input(rows([])));
    expect(result).toEqual({
      attributes: ["country"],
      responses: [],
      leaf_map: [],
    });
  });

  it("weights the better-performing arm more heavily (single context)", () => {
    const data = rows([
      countRow("US", "v0", 200, 1),
      countRow("US", "v1", 200, 2),
    ]);

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

  it("honors the inverse flag (lower mean is better)", () => {
    const data = rows([
      countRow("US", "v0", 200, 1),
      countRow("US", "v1", 200, 2),
    ]);

    const result = computeContextualBanditWeights(input(data, true));
    const weights = result.responses[0].updatedWeights as number[];
    expect(weights[0]).toBeGreaterThan(weights[1]);
  });

  it("falls back to the analysis weights when an arm has < 100 units", () => {
    const data = rows([
      countRow("US", "v0", 50, 1),
      countRow("US", "v1", 50, 2),
    ]);

    const result = computeContextualBanditWeights(input(data));
    const r = result.responses[0];
    expect(r.updatedWeights).toEqual([0.5, 0.5]);
    expect(r.bestArmProbabilities).toBeNull();
    expect(r.updateMessage).toBe(
      "total sample size must be at least 100 per variation",
    );
  });

  it("splits differing contexts into separate leaves with distinct weights", () => {
    const data = rows([
      countRow("US", "v0", 200, 1),
      countRow("US", "v1", 200, 2),
      countRow("CA", "v0", 200, 2),
      countRow("CA", "v1", 200, 1),
    ]);

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

  it("records the total-SSE trajectory across splits (root then after each split)", () => {
    const data = rows([
      countRow("US", "v0", 200, 1),
      countRow("US", "v1", 200, 2),
      countRow("CA", "v0", 200, 2),
      countRow("CA", "v1", 200, 1),
    ]);

    const result = computeContextualBanditWeights(input(data));

    expect(result.sse_trajectory).toBeDefined();
    expect(result.sse_trajectory!.map((s) => s.numSplits)).toEqual([0, 1]);

    expect(result.sse_trajectory![0].totalSse).toBeCloseTo(996, 6);
    expect(result.sse_trajectory![1].totalSse).toBeCloseTo(796, 6);

    expect(result.sse_trajectory![1].totalSse).toBeLessThan(
      result.sse_trajectory![0].totalSse,
    );
  });

  it("returns a single root entry in the SSE trajectory when no split helps", () => {
    const data = rows([
      countRow("US", "v0", 200, 1),
      countRow("US", "v1", 200, 2),
    ]);

    const result = computeContextualBanditWeights(input(data));

    expect(result.sse_trajectory!.map((s) => s.numSplits)).toEqual([0]);
    expect(result.sse_trajectory![0].totalSse).toBeCloseTo(398, 6);
  });

  it("keeps identical contexts in a single leaf", () => {
    const data = rows([
      countRow("US", "v0", 200, 1),
      countRow("US", "v1", 200, 2),
      countRow("CA", "v0", 200, 1),
      countRow("CA", "v1", 200, 2),
    ]);

    const result = computeContextualBanditWeights(input(data));

    expect(result.responses).toHaveLength(2);
    const leafIds = result.leaf_map!.map((e) => e.leafId);
    expect(new Set(leafIds).size).toBe(1);

    const [a, b] = result.responses;
    expect(a.updatedWeights).toEqual(b.updatedWeights);
  });

  it("produces stable weights across runs (within Monte Carlo noise)", () => {
    const data = rows([
      countRow("US", "v0", 200, 1),
      countRow("US", "v1", 200, 1.2),
    ]);
    const first = computeContextualBanditWeights(input(data));
    const second = computeContextualBanditWeights(input(data));
    const w1 = first.responses[0].updatedWeights as number[];
    const w2 = second.responses[0].updatedWeights as number[];
    expect(w1).toHaveLength(w2.length);
    w1.forEach((w, i) => {
      expect(Math.abs(w - w2[i])).toBeLessThan(0.02);
    });
  });
});
