import { GrowthBook } from "../src";

// Builds a feature whose single rule is a contextual bandit with two leaves:
//   - leaf 1: plan == "enterprise" -> always variation 0 ("control")
//   - leaf 2: catch-all ({})       -> always variation 1 ("treatment")
// Deterministic weights ([1,0] / [0,1]) let us assert which leaf matched purely
// from the assigned variation.
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
          // Marginal weights (the multi-armed-bandit fallback). Forces
          // variation 0 if the CB leaf logic is bypassed, so a test landing on
          // variation 1 proves the catch-all leaf weights were used instead.
          weights: [1, 0],
          meta: [{ key: "0" }, { key: "1" }],
          isContextualBandit: true,
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
    // The exact weights used to bucket the user (leaf 1) + the training period.
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
    // Catch-all leaf weights are [0,1] -> variation 1, which the marginal
    // weights ([1,0]) would never produce. Proves leaf weights were applied.
    expect(res.value).toEqual("treatment");
    expect(res.experimentResult?.variationId).toEqual(1);
    expect(res.experimentResult?.leafId).toEqual(2);
    expect(res.experimentResult?.variationWeights).toEqual([0, 1]);

    gb.destroy();
  });

  it("fails closed (skips the rule, no exposure) when a required attribute is missing", () => {
    const trackingCallback = jest.fn();
    const gb = new GrowthBook({
      attributes: { id: "u1" }, // no `plan`
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

    // Additive: the standard callback still fires.
    expect(trackingCallback.mock.calls.length).toEqual(1);

    expect(trackingCallbackWithAttribute.mock.calls.length).toEqual(1);
    const [experiment, result, attributes] =
      trackingCallbackWithAttribute.mock.calls[0];
    expect(experiment.key).toEqual("promo_bandit");
    expect(result.leafId).toEqual(1);
    expect(result.variationId).toEqual(0);
    // Luke's ask: the events table needs the weights used + the training period.
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
      // No `plan` attribute: an empty contexts[] must NOT enforce
      // attributesRequired, since there are no leaves to route into.
      attributes: { id: "u1" },
      features: cbFeatures({ contexts: [] }),
    });

    const res = gb.evalFeature("promo");
    expect(res.source).toEqual("experiment");
    // Marginal weights [1,0] -> variation 0, and no leaf was selected.
    expect(res.value).toEqual("control");
    expect(res.experimentResult?.variationId).toEqual(0);
    expect(res.experimentResult?.leafId).toBeUndefined();
    // No leaf was selected, so no per-leaf weights / period are recorded.
    expect(res.experimentResult?.variationWeights).toBeUndefined();
    expect(res.experimentResult?.banditVersion).toBeUndefined();

    gb.destroy();
  });
});
