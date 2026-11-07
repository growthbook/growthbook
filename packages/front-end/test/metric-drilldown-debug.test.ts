import { describe, expect, it } from "vitest";
import { SnapshotMetric } from "shared/types/experiment-snapshot";
import { getMetricDrilldownDebugVariations } from "@/components/MetricDrilldown/helpers";

const variation: SnapshotMetric = {
  users: 40000,
  value: 1480000,
  cr: 37,
  expected: -0.0012,
  pValue: 0.033,
  pValueAdjusted: 0.042,
  ci: [-0.0024, -0.0001],
  ciAdjusted: [-0.0025, -0.00005],
  supplementalResults: {
    cupedUnadjusted: {
      users: 40000,
      value: 1480000,
      cr: 37,
      stats: { users: 40000, count: 40000, mean: 37, stddev: 150 },
      expected: 0.00075,
      pValue: 0.411,
      ci: [-0.001, 0.0025],
    },
  },
};

describe("getMetricDrilldownDebugVariations", () => {
  it("uses the main analysis's own p-value and interval without mutating it", () => {
    const [result] = getMetricDrilldownDebugVariations([variation]);

    expect(result.pValue).toBe(0.033);
    expect(result.ci).toEqual([-0.0024, -0.0001]);
    expect(result.expected).toBe(-0.0012);
    expect(result).not.toHaveProperty("pValueAdjusted");
    expect(result).not.toHaveProperty("ciAdjusted");
    expect(variation.pValueAdjusted).toBe(0.042);
    expect(variation.ciAdjusted).toEqual([-0.0025, -0.00005]);
  });

  it("keeps a positive CUPED-off estimate with its nonsignificant p-value and interval", () => {
    const [result] = getMetricDrilldownDebugVariations(
      [variation],
      "cupedUnadjusted",
    );

    expect(result.expected).toBe(0.00075);
    expect(result.pValue).toBe(0.411);
    expect(result.ci).toEqual([-0.001, 0.0025]);
    expect(result.stats?.stddev).toBe(150);
    expect(result).not.toHaveProperty("pValueAdjusted");
    expect(result).not.toHaveProperty("ciAdjusted");
    expect(variation.expected).toBe(-0.0012);
  });

  it("falls back to the main analysis when supplemental results are missing", () => {
    const [result] = getMetricDrilldownDebugVariations([variation], "uncapped");

    expect(result.pValue).toBe(0.033);
    expect(result.ci).toEqual([-0.0024, -0.0001]);
    expect(result).not.toHaveProperty("pValueAdjusted");
    expect(result).not.toHaveProperty("ciAdjusted");
  });

  it("preserves Bayesian statistics when selecting a flat prior", () => {
    const [result] = getMetricDrilldownDebugVariations(
      [
        {
          users: 40000,
          value: 1480000,
          cr: 37,
          chanceToWin: 0.95,
          risk: [0.01, 0.02],
          supplementalResults: {
            flatPrior: {
              users: 40000,
              value: 1480000,
              cr: 37,
              stats: { users: 40000, count: 40000, mean: 37, stddev: 150 },
              chanceToWin: 0.7,
              risk: [0.03, 0.04],
              ci: [-0.01, 0.02],
            },
          },
        },
      ],
      "flatPrior",
    );

    expect(result.chanceToWin).toBe(0.7);
    expect(result.risk).toEqual([0.03, 0.04]);
    expect(result.ci).toEqual([-0.01, 0.02]);
  });
});
