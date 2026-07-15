import { GrowthBook } from "../src";
import { GrowthBookClient } from "../src/GrowthBookClient";
import { ContextualBanditsMap } from "../src/types/growthbook";

function cbRule(overrides: Record<string, unknown> = {}) {
  return {
    key: "promo_bandit",
    seed: "promo_bandit",
    hashAttribute: "id",
    hashVersion: 2,
    coverage: 1,
    contextualVariations: ["control", "treatment"],
    weights: [1, 0],
    meta: [{ key: "0" }, { key: "1" }],
    isContextualBandit: true,
    contextualBanditRef: "cb_promo",
    ...overrides,
  };
}

function cbFeatures(overrides: Record<string, unknown> = {}) {
  return {
    promo: {
      defaultValue: "default",
      rules: [cbRule(overrides)],
    },
  };
}

function cbMap(overrides: Record<string, unknown> = {}): ContextualBanditsMap {
  return {
    cb_promo: {
      banditVersion: 7,
      attributesRequired: ["plan"],
      contexts: [
        { leafId: 1, condition: { plan: "enterprise" }, weights: [1, 0] },
        { leafId: 2, condition: {}, weights: [0, 1] },
      ],
      ...overrides,
    },
  };
}

describe("contextual bandit feature rules", () => {
  it("routes a user into the matching leaf and uses that leaf's weights", () => {
    const gb = new GrowthBook({
      attributes: { id: "u1", plan: "enterprise" },
      features: cbFeatures(),
      contextualBandits: cbMap(),
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

  it("skips a CB rule whose variations were stripped (old-SDK payload), no even-split fallback", () => {
    // An SDK without the contextualBandits capability drops the
    // `contextualVariations` key and never sees `variations`, so the rule must
    // be skipped and fall through to the default rather than run as a plain
    // 50/50 experiment.
    const gb = new GrowthBook({
      attributes: { id: "u1", plan: "enterprise" },
      features: {
        promo: {
          defaultValue: "default",
          rules: [
            {
              key: "promo_bandit",
              seed: "promo_bandit",
              hashAttribute: "id",
              hashVersion: 2,
              coverage: 1,
              weights: [1, 0],
              meta: [{ key: "0" }, { key: "1" }],
              isContextualBandit: true,
              contextualBanditRef: "cb_promo",
            },
          ],
        },
      },
      contextualBandits: cbMap(),
    });

    const res = gb.evalFeature("promo");
    expect(res.source).toEqual("defaultValue");
    expect(res.value).toEqual("default");
    expect(res.experimentResult).toBeUndefined();

    gb.destroy();
  });

  it("falls through to the catch-all leaf when no specific leaf matches", () => {
    const gb = new GrowthBook({
      attributes: { id: "u1", plan: "free" },
      features: cbFeatures(),
      contextualBandits: cbMap(),
    });

    const res = gb.evalFeature("promo");
    expect(res.source).toEqual("experiment");
    expect(res.value).toEqual("treatment");
    expect(res.experimentResult?.variationId).toEqual(1);
    expect(res.experimentResult?.leafId).toEqual(2);
    expect(res.experimentResult?.variationWeights).toEqual([0, 1]);

    gb.destroy();
  });

  it("resolves the same contextualBandits entry from multiple linked features", () => {
    const gb = new GrowthBook({
      attributes: { id: "u1", plan: "enterprise" },
      features: {
        ...cbFeatures(),
        banner: {
          defaultValue: "off",
          rules: [
            cbRule({
              contextualVariations: ["off", "on"],
            }),
          ],
        },
      },
      contextualBandits: cbMap(),
    });

    const promo = gb.evalFeature("promo");
    const banner = gb.evalFeature("banner");
    expect(promo.experimentResult?.leafId).toEqual(1);
    expect(banner.experimentResult?.leafId).toEqual(1);
    expect(banner.value).toEqual("off");
    expect(banner.experimentResult?.banditVersion).toEqual(7);

    gb.destroy();
  });

  it("fails closed (skips the rule, no exposure) when a required attribute is missing", () => {
    const trackingCallback = jest.fn();
    const gb = new GrowthBook({
      attributes: { id: "u1" },
      trackingCallback,
      features: cbFeatures(),
      contextualBandits: cbMap(),
    });

    const res = gb.evalFeature("promo");
    expect(res.source).toEqual("defaultValue");
    expect(res.value).toEqual("default");
    expect(res.experimentResult).toBeUndefined();
    expect(trackingCallback.mock.calls.length).toEqual(0);

    gb.destroy();
  });

  it("fails closed (does not crash) when leaf selection throws", () => {
    const trackingCallback = jest.fn();
    // A condition that throws when evaluated (e.g. a malformed payload).
    const throwingCondition = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("boom");
        },
      },
    ) as Record<string, unknown>;
    const bandits = cbMap();
    bandits.cb_promo.contexts[0].condition = throwingCondition;

    const gb = new GrowthBook({
      attributes: { id: "u1", plan: "enterprise" },
      trackingCallback,
      features: cbFeatures(),
      contextualBandits: bandits,
    });

    // Should not throw; the rule is skipped and we fall through to the default.
    let res: ReturnType<typeof gb.evalFeature>;
    expect(() => {
      res = gb.evalFeature("promo");
    }).not.toThrow();
    expect(res!.source).toEqual("defaultValue");
    expect(res!.value).toEqual("default");
    expect(res!.experimentResult).toBeUndefined();
    expect(trackingCallback.mock.calls.length).toEqual(0);

    gb.destroy();
  });

  it("passes resolved attributes to the standard trackingCallback for CB exposures", () => {
    const trackingCallback = jest.fn();
    const gb = new GrowthBook({
      attributes: { id: "u1", plan: "enterprise" },
      trackingCallback,
      features: cbFeatures(),
      contextualBandits: cbMap(),
    });

    gb.evalFeature("promo");

    expect(trackingCallback.mock.calls.length).toEqual(1);
    const [experiment, result, user] = trackingCallback.mock.calls[0];
    expect(experiment.key).toEqual("promo_bandit");
    expect(result.leafId).toEqual(1);
    expect(result.variationId).toEqual(0);
    expect(result.variationWeights).toEqual([1, 0]);
    expect(result.banditVersion).toEqual(7);
    expect(user.attributes).toEqual({ id: "u1", plan: "enterprise" });

    gb.destroy();
  });

  it("passes attributes to the trackingCallback for non-CB experiments too (no leaf data on result)", () => {
    const trackingCallback = jest.fn();
    const gb = new GrowthBook({
      attributes: { id: "u1" },
      trackingCallback,
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

    expect(trackingCallback.mock.calls.length).toEqual(1);
    const [, result, user] = trackingCallback.mock.calls[0];
    expect(result.leafId).toBeUndefined();
    expect(result.banditVersion).toBeUndefined();
    expect(user.attributes).toEqual({ id: "u1" });

    gb.destroy();
  });

  it("falls back to marginal weights when contexts[] is empty (MAB behavior)", () => {
    const gb = new GrowthBook({
      attributes: { id: "u1" },
      features: cbFeatures(),
      contextualBandits: cbMap({ contexts: [] }),
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

  it("falls back to marginal weights when the contextualBanditRef is dangling", () => {
    const gb = new GrowthBook({
      attributes: { id: "u1" },
      features: cbFeatures(),
      // No contextualBandits map at all
    });

    const res = gb.evalFeature("promo");
    expect(res.source).toEqual("experiment");
    expect(res.value).toEqual("control");
    expect(res.experimentResult?.variationId).toEqual(0);
    expect(res.experimentResult?.leafId).toBeUndefined();
    expect(res.experimentResult?.banditVersion).toBeUndefined();

    gb.destroy();
  });

  it("preserves attributes through deferred tracking calls", async () => {
    // No trackingCallback at eval time => the exposure is deferred.
    const gb = new GrowthBook({
      attributes: { id: "u1", plan: "enterprise" },
      features: cbFeatures(),
      contextualBandits: cbMap(),
    });

    gb.evalFeature("promo");

    const deferred = gb.getDeferredTrackingCalls();
    expect(deferred.length).toEqual(1);
    expect(deferred[0].user?.attributes).toEqual({
      id: "u1",
      plan: "enterprise",
    });
    expect(deferred[0].result.leafId).toEqual(1);
    expect(deferred[0].result.banditVersion).toEqual(7);

    const trackingCallback = jest.fn();
    gb.setTrackingCallback(trackingCallback);
    await gb.fireDeferredTrackingCalls();

    expect(trackingCallback.mock.calls.length).toEqual(1);
    const [, result, user] = trackingCallback.mock.calls[0];
    expect(result.variationWeights).toEqual([1, 0]);
    expect(user.attributes).toEqual({ id: "u1", plan: "enterprise" });

    gb.destroy();
  });

  it("ingests contextualBandits from a payload via setPayload", async () => {
    const gb = new GrowthBook({
      attributes: { id: "u1", plan: "enterprise" },
    });
    await gb.setPayload({
      features: cbFeatures(),
      contextualBandits: cbMap(),
    });

    const res = gb.evalFeature("promo");
    expect(res.experimentResult?.leafId).toEqual(1);
    expect(res.experimentResult?.banditVersion).toEqual(7);

    gb.destroy();
  });

  it("ingests contextualBandits from a payload via initSync (routes to the matched leaf)", () => {
    const gb = new GrowthBook({
      attributes: { id: "u1", plan: "enterprise" },
    });
    gb.initSync({
      payload: {
        features: cbFeatures(),
        contextualBandits: cbMap(),
      },
    });

    const res = gb.evalFeature("promo");
    expect(res.source).toEqual("experiment");
    expect(res.value).toEqual("control");
    expect(res.experimentResult?.leafId).toEqual(1);
    expect(res.experimentResult?.variationWeights).toEqual([1, 0]);
    expect(res.experimentResult?.banditVersion).toEqual(7);

    gb.destroy();
  });

  it("ingests contextualBandits from a payload via GrowthBookClient.initSync", () => {
    const gb = new GrowthBookClient();
    gb.initSync({
      payload: {
        features: cbFeatures(),
        contextualBandits: cbMap(),
      },
    });

    const res = gb.evalFeature("promo", {
      attributes: { id: "u1", plan: "enterprise" },
    });
    expect(res.source).toEqual("experiment");
    expect(res.value).toEqual("control");
    expect(res.experimentResult?.leafId).toEqual(1);
    expect(res.experimentResult?.variationWeights).toEqual([1, 0]);
    expect(res.experimentResult?.banditVersion).toEqual(7);

    gb.destroy();
  });
});
