import type { ContextualBanditSnapshot } from "shared/types/stats";
import { buildContextualBanditResultsView } from "../src/experiments/contextual-bandit-results";

const variations = [
  { id: "v0", name: "Control" },
  { id: "v1", name: "Treatment" },
];

const snapshot: ContextualBanditSnapshot = {
  attributes: ["country"],
  responses: [
    {
      context: { country: "US" },
      sampleSizePerVariation: [500, 470],
      sampleMeans: [0.118, 0.151],
      sampleVariances: [0.1, 0.11],
      updatedWeights: [0.6, 0.4],
      bestArmProbabilities: [0.62, 0.38],
      updateMessage: "Successfully updated",
      error: null,
    },
    {
      context: { country: "CA" },
      sampleSizePerVariation: [300, 290],
      sampleMeans: [0.126, 0.146],
      sampleVariances: [0.09, 0.12],
      updatedWeights: [0.6, 0.4],
      bestArmProbabilities: [0.62, 0.38],
      updateMessage: "Successfully updated",
      error: null,
    },
    {
      context: { country: "MX" },
      sampleSizePerVariation: [100, 110],
      sampleMeans: [0.2, 0.18],
      sampleVariances: [0.05, 0.06],
      updatedWeights: [0.3, 0.7],
      bestArmProbabilities: [0.31, 0.69],
      updateMessage: "Successfully updated",
      error: null,
    },
  ],
  leaf_map: [
    { context: { country: "US" }, leafId: 3 },
    { context: { country: "CA" }, leafId: 3 },
    { context: { country: "MX" }, leafId: 7 },
  ],
  leaf_stats: [
    {
      leafId: 3,
      sampleSizePerVariation: [800, 760],
      sampleMeans: [0.121, 0.149],
      sampleVariances: [0.1, 0.11],
    },
    {
      leafId: 7,
      sampleSizePerVariation: [100, 110],
      sampleMeans: [0.2, 0.18],
      sampleVariances: [0.05, 0.06],
    },
  ],
  sse_trajectory: [
    { numSplits: 0, totalSse: 200 },
    { numSplits: 1, totalSse: 150 },
  ],
};

describe("buildContextualBanditResultsView", () => {
  const view = buildContextualBanditResultsView(snapshot, variations);

  it("passes through the attribute list", () => {
    expect(view.attributes).toEqual(["country"]);
  });

  it("groups contexts under their leaf, sorted by leafId", () => {
    expect(view.leaves.map((l) => l.leafId)).toEqual([3, 7]);
    expect(view.leaves[0].contexts.map((c) => c.attributes.country)).toEqual([
      "US",
      "CA",
    ]);
    expect(view.leaves[1].contexts.map((c) => c.attributes.country)).toEqual([
      "MX",
    ]);
  });

  it("puts shared weights + diagnostics on the leaf", () => {
    const leaf = view.leaves[0];
    expect(leaf.variations.map((v) => v.weight)).toEqual([0.6, 0.4]);
    expect(leaf.variations.map((v) => v.bestArmProbability)).toEqual([
      0.62, 0.38,
    ]);
    expect(leaf.variations.map((v) => v.variationId)).toEqual(["v0", "v1"]);
    expect(leaf.variations.map((v) => v.variationName)).toEqual([
      "Control",
      "Treatment",
    ]);
    expect(leaf.variations.map((v) => v.users)).toEqual([800, 760]);
    expect(leaf.variations.map((v) => v.mean)).toEqual([0.121, 0.149]);
  });

  it("exposes the total-SSE trajectory root-first", () => {
    expect(view.sseTrajectory).toEqual([
      { numSplits: 0, totalSse: 200 },
      { numSplits: 1, totalSse: 150 },
    ]);
  });

  it("defaults sseTrajectory to an empty array when absent", () => {
    const noSse = buildContextualBanditResultsView(
      {
        attributes: ["country"],
        responses: [
          {
            context: { country: "US" },
            sampleSizePerVariation: [10, 10],
            updatedWeights: [0.5, 0.5],
            updateMessage: "Successfully updated",
            error: null,
          },
        ],
        leaf_map: [{ context: { country: "US" }, leafId: 0 }],
      },
      variations,
    );
    expect(noSse.sseTrajectory).toEqual([]);
  });

  it("keeps per-context means distinct within a leaf", () => {
    const [us, ca] = view.leaves[0].contexts;
    expect(us.variations.map((v) => v.mean)).toEqual([0.118, 0.151]);
    expect(ca.variations.map((v) => v.mean)).toEqual([0.126, 0.146]);
    expect(us.variations.map((v) => v.users)).toEqual([500, 470]);
    expect(us.variations[0]).not.toHaveProperty("weight");
  });

  it("computes overall weights + total users across all contexts", () => {
    const overall = view.overall.variations;
    expect(overall.map((v) => v.variationId)).toEqual(["v0", "v1"]);
    expect(overall.map((v) => v.users)).toEqual([900, 870]);
    expect(overall[0].weight).not.toBeNull();
    expect((overall[0].weight ?? 0) + (overall[1].weight ?? 0)).toBeCloseTo(
      1,
      10,
    );
  });

  it("throws when a leaf is missing updatedWeights (no best-arm fallback)", () => {
    expect(() =>
      buildContextualBanditResultsView(
        {
          attributes: ["country"],
          responses: [
            {
              context: { country: "US" },
              sampleSizePerVariation: [10, 10],
              bestArmProbabilities: [0.9, 0.1],
              updateMessage: "Successfully updated",
              error: null,
            },
          ],
          leaf_map: [{ context: { country: "US" }, leafId: 0 }],
        },
        variations,
      ),
    ).toThrow(/updatedWeights/);
  });

  it("returns an empty leaf list for an empty snapshot", () => {
    const empty = buildContextualBanditResultsView(
      { attributes: ["country"], responses: [], leaf_map: [] },
      variations,
    );
    expect(empty.leaves).toEqual([]);
    expect(empty.overall.variations.map((v) => v.users)).toEqual([0, 0]);
  });
});
