import { GrowthBook } from "../src";

function cbFeatures(overrides: Record<string, unknown> = {}) {
  return {
    promo: {
      defaultValue: "default",
      rules: [
        {
          key: "promo_bandit",
          seed: "promo_bandit",
          hashAttribute: "id",
          hashVersion: 2,
          coverage: 1,
          variations: ["control", "treatment"],
          weights: [1, 0],
          meta: [{ key: "0" }, { key: "1" }],
          type: "contextual-bandit" as const,
          banditVersion: 7,
          attributesRequired: ["plan"],
          contexts: [
            { leafId: 1, condition: { plan: "enterprise" }, weights: [1, 0] },
            { leafId: 2, condition: {}, weights: [0, 1] },
          ],
          ...overrides,
        },
      ],
    },
  };
}

describe("contextual bandit feature rules", () => {
  it("routes a user into the matching leaf and uses that leaf's weights", () => {
    const gb = new GrowthBook({
      attributes: { id: "u1", plan: "enterprise" },
      features: cbFeatures(),
    });

    const res = gb.evalFeature("promo");
    expect(res.source).toEqual("experiment");
    expect(res.value).toEqual("control");
    expect(res.experimentResult?.inExperiment).toEqual(true);
    expect(res.experimentResult?.variationId).toEqual(0);
    expect(res.experimentResult?.leafId).toEqual(1);
    expect(res.experimentResult?.variationWeights).toEqual([1, 0]);
    expect(res.experimentResult?.banditVersion).toEqual(7);

    gb.destroy();
  });

  it("falls through to the catch-all leaf when no specific leaf matches", () => {
    const gb = new GrowthBook({
      attributes: { id: "u1", plan: "free" },
      features: cbFeatures(),
    });

    const res = gb.evalFeature("promo");
    expect(res.source).toEqual("experiment");
    expect(res.value).toEqual("treatment");
    expect(res.experimentResult?.variationId).toEqual(1);
    expect(res.experimentResult?.leafId).toEqual(2);
    expect(res.experimentResult?.variationWeights).toEqual([0, 1]);

    gb.destroy();
  });

  it("fails closed (skips the rule, no exposure) when a required attribute is missing", () => {
    const trackingCallback = jest.fn();
    const gb = new GrowthBook({
      attributes: { id: "u1" },
      trackingCallback,
      features: cbFeatures(),
    });

    const res = gb.evalFeature("promo");
    expect(res.source).toEqual("defaultValue");
    expect(res.value).toEqual("default");
    expect(res.experimentResult).toBeUndefined();
    expect(trackingCallback.mock.calls.length).toEqual(0);

    gb.destroy();
  });

  it("fires trackingCallbackWithAttribute (and the standard callback) for CB exposures", () => {
    const trackingCallback = jest.fn();
    const trackingCallbackWithAttribute = jest.fn();
    const gb = new GrowthBook({
      attributes: { id: "u1", plan: "enterprise" },
      trackingCallback,
      trackingCallbackWithAttribute,
      features: cbFeatures(),
    });

    gb.evalFeature("promo");

    expect(trackingCallback.mock.calls.length).toEqual(1);

    expect(trackingCallbackWithAttribute.mock.calls.length).toEqual(1);
    const [experiment, result, attributes] =
      trackingCallbackWithAttribute.mock.calls[0];
    expect(experiment.key).toEqual("promo_bandit");
    expect(result.leafId).toEqual(1);
    expect(result.variationId).toEqual(0);
    expect(result.variationWeights).toEqual([1, 0]);
    expect(result.banditVersion).toEqual(7);
    expect(attributes).toEqual({ id: "u1", plan: "enterprise" });

    gb.destroy();
  });

  it("does not fire trackingCallbackWithAttribute for non-CB experiments", () => {
    const trackingCallbackWithAttribute = jest.fn();
    const gb = new GrowthBook({
      attributes: { id: "u1" },
      trackingCallbackWithAttribute,
      features: {
        plain: {
          defaultValue: "default",
          rules: [
            {
              key: "plain_exp",
              seed: "plain_exp",
              hashAttribute: "id",
              hashVersion: 2,
              coverage: 1,
              variations: ["control", "treatment"],
              weights: [0, 1],
              meta: [{ key: "0" }, { key: "1" }],
            },
          ],
        },
      },
    });

    const res = gb.evalFeature("plain");
    expect(res.source).toEqual("experiment");
    expect(res.experimentResult?.leafId).toBeUndefined();
    expect(trackingCallbackWithAttribute.mock.calls.length).toEqual(0);

    gb.destroy();
  });

  it("falls back to marginal weights when contexts[] is empty (MAB behavior)", () => {
    const gb = new GrowthBook({
      attributes: { id: "u1" },
      features: cbFeatures({ contexts: [] }),
    });

    const res = gb.evalFeature("promo");
    expect(res.source).toEqual("experiment");
    expect(res.value).toEqual("control");
    expect(res.experimentResult?.variationId).toEqual(0);
    expect(res.experimentResult?.leafId).toBeUndefined();
    expect(res.experimentResult?.variationWeights).toBeUndefined();
    expect(res.experimentResult?.banditVersion).toBeUndefined();

    gb.destroy();
  });
});
