import {
  getCrossFtPairKey,
  isCrossFtRatioMetric,
  planMetricFanOut,
} from "back-end/src/services/experimentQueries/planMetricFanOut";
import { factMetricFactory } from "../factories/FactMetric.factory";

describe("planMetricFanOut", () => {
  describe("isCrossFtRatioMetric", () => {
    it("returns false for non-ratio metrics", () => {
      const metric = factMetricFactory.build({
        metricType: "mean",
        numerator: { factTableId: "ft_a" },
      });
      expect(isCrossFtRatioMetric(metric)).toBe(false);
    });

    it("returns false for same-FT ratio metrics", () => {
      const metric = factMetricFactory.build({
        metricType: "ratio",
        numerator: { factTableId: "ft_a", column: "x" },
        denominator: { factTableId: "ft_a", column: "y" },
      });
      expect(isCrossFtRatioMetric(metric)).toBe(false);
    });

    it("returns true for cross-FT ratio metrics", () => {
      const metric = factMetricFactory.build({
        metricType: "ratio",
        numerator: { factTableId: "ft_a", column: "x" },
        denominator: { factTableId: "ft_b", column: "y" },
      });
      expect(isCrossFtRatioMetric(metric)).toBe(true);
    });
  });

  describe("getCrossFtPairKey", () => {
    it("is symmetric in its arguments", () => {
      expect(getCrossFtPairKey("ft_a", "ft_b")).toBe(
        getCrossFtPairKey("ft_b", "ft_a"),
      );
    });

    it("returns distinct keys for distinct unordered pairs", () => {
      expect(getCrossFtPairKey("ft_a", "ft_b")).not.toBe(
        getCrossFtPairKey("ft_a", "ft_c"),
      );
    });
  });

  describe("fan-out", () => {
    it("emits one entry per same-FT metric in its numerator FT", () => {
      const meanA = factMetricFactory.build({
        id: "mean_a",
        metricType: "mean",
        numerator: { factTableId: "ft_a" },
      });
      const sameFtRatio = factMetricFactory.build({
        id: "same_ft_ratio",
        metricType: "ratio",
        numerator: { factTableId: "ft_a", column: "x" },
        denominator: { factTableId: "ft_a", column: "y" },
      });
      const fanOut = planMetricFanOut([meanA, sameFtRatio]);

      expect(fanOut.crossFtPairs).toEqual([]);
      expect(fanOut.perFt).toHaveLength(1);
      expect(fanOut.perFt[0].factTableId).toBe("ft_a");
      expect(fanOut.perFt[0].metrics.map((m) => m.id)).toEqual([
        "mean_a",
        "same_ft_ratio",
      ]);
    });

    it("fans a cross-FT ratio metric into both fact-table caches", () => {
      // Each cache holds the same metric reference; which side it
      // materializes is derived downstream by comparing the metric's
      // numerator/denominator factTableId to the cache's own factTableId.
      const crossFtRatio = factMetricFactory.build({
        id: "cross_ft_ratio",
        metricType: "ratio",
        numerator: { factTableId: "ft_a", column: "x" },
        denominator: { factTableId: "ft_b", column: "y" },
      });
      const fanOut = planMetricFanOut([crossFtRatio]);

      const ftA = fanOut.perFt.find((g) => g.factTableId === "ft_a");
      const ftB = fanOut.perFt.find((g) => g.factTableId === "ft_b");
      expect(ftA?.metrics.map((m) => m.id)).toEqual(["cross_ft_ratio"]);
      expect(ftB?.metrics.map((m) => m.id)).toEqual(["cross_ft_ratio"]);

      expect(fanOut.crossFtPairs).toHaveLength(1);
      expect(fanOut.crossFtPairs[0].factTableIds).toEqual(["ft_a", "ft_b"]);
      expect(fanOut.crossFtPairs[0].metrics).toEqual([
        {
          metric: crossFtRatio,
          numeratorFactTableId: "ft_a",
          denominatorFactTableId: "ft_b",
        },
      ]);
    });

    it("collapses cross-FT pairs that share the same unordered fact-table set", () => {
      // Two metrics whose orientations differ — one is ft_a / ft_b, the other
      // is ft_b / ft_a — must collide into a single pair entry so we run a
      // single joined stats query against the same two cache tables.
      const aOverB = factMetricFactory.build({
        id: "a_over_b",
        metricType: "ratio",
        numerator: { factTableId: "ft_a", column: "x" },
        denominator: { factTableId: "ft_b", column: "y" },
      });
      const bOverA = factMetricFactory.build({
        id: "b_over_a",
        metricType: "ratio",
        numerator: { factTableId: "ft_b", column: "x" },
        denominator: { factTableId: "ft_a", column: "y" },
      });
      const fanOut = planMetricFanOut([aOverB, bOverA]);

      expect(fanOut.crossFtPairs).toHaveLength(1);
      expect(fanOut.crossFtPairs[0].factTableIds).toEqual(["ft_a", "ft_b"]);
      expect(fanOut.crossFtPairs[0].metrics.map((m) => m.metric.id)).toEqual([
        "a_over_b",
        "b_over_a",
      ]);

      // Both FT caches end up with both metrics — orientation is recovered
      // per-metric by comparing column refs to the cache's factTableId.
      const ftA = fanOut.perFt.find((g) => g.factTableId === "ft_a");
      const ftB = fanOut.perFt.find((g) => g.factTableId === "ft_b");
      expect(ftA?.metrics.map((m) => m.id).sort()).toEqual([
        "a_over_b",
        "b_over_a",
      ]);
      expect(ftB?.metrics.map((m) => m.id).sort()).toEqual([
        "a_over_b",
        "b_over_a",
      ]);
    });

    it("mixes same-FT and cross-FT metrics without colliding their entries", () => {
      const meanA = factMetricFactory.build({
        id: "mean_a",
        metricType: "mean",
        numerator: { factTableId: "ft_a" },
      });
      const crossFt = factMetricFactory.build({
        id: "cross_ft",
        metricType: "ratio",
        numerator: { factTableId: "ft_a", column: "x" },
        denominator: { factTableId: "ft_b", column: "y" },
      });
      const meanB = factMetricFactory.build({
        id: "mean_b",
        metricType: "mean",
        numerator: { factTableId: "ft_b" },
      });
      const fanOut = planMetricFanOut([meanA, crossFt, meanB]);

      // Per-FT entries are ordered by the supplied metric list — ft_a first
      // (mean_a, cross_ft on its numerator side), then ft_b (cross_ft on its
      // denominator side, mean_b).
      expect(fanOut.perFt.map((g) => g.factTableId)).toEqual(["ft_a", "ft_b"]);
      expect(fanOut.perFt[0].metrics.map((m) => m.id)).toEqual([
        "mean_a",
        "cross_ft",
      ]);
      expect(fanOut.perFt[1].metrics.map((m) => m.id)).toEqual([
        "cross_ft",
        "mean_b",
      ]);
      expect(fanOut.crossFtPairs).toHaveLength(1);
    });

    it("throws when a metric lacks a numerator fact table", () => {
      const broken = factMetricFactory.build({
        id: "broken",
        metricType: "mean",
      });
      // Force-clear the factTableId to simulate a malformed metric.
      (broken.numerator as { factTableId: string }).factTableId = "";
      expect(() => planMetricFanOut([broken])).toThrow();
    });
  });
});
