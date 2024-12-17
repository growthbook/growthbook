import {
  Experiment,
  FeatureApiResponse,
  FeatureRule,
  LocalStorageStickyBucketService,
  UserContext,
} from "../src";
import { GrowthBookClient } from "../src/GrowthBookClient";
require("jest-localstorage-mock");

describe("GrowthBookClient", () => {
  it("Supports basic feature evaluation", async () => {
    const gb = new GrowthBookClient();
    await gb.init({
      payload: {
        features: {
          feature: {
            defaultValue: false,
            rules: [
              {
                condition: { country: "US" },
                force: true,
              },
            ],
          },
        },
      },
    });

    expect(
      gb.isOn("feature", {
        attributes: {
          country: "US",
        },
      })
    ).toEqual(true);

    expect(
      gb.isOn("feature", {
        attributes: {
          country: "GB",
        },
      })
    ).toEqual(false);

    gb.destroy();
  });

  it("Fires tracking callback with user", async () => {
    const track = jest.fn();
    const gb = new GrowthBookClient({
      trackingCallback: track,
    });

    await gb.init({ payload: {} });

    const exp: Experiment<boolean> = {
      key: "my-experiment",
      variations: [false, true],
      hashAttribute: "id",
      hashVersion: 2,
    };

    const user: UserContext = {
      attributes: {
        id: "1",
      },
    };

    const res = gb.runInlineExperiment(exp, user);

    expect(track).toHaveBeenCalledWith(exp, res, user);

    gb.destroy();
  });

  it("Fires feature usage callback with user", async () => {
    const track = jest.fn();
    const gb = new GrowthBookClient({
      onFeatureUsage: track,
    });

    gb.initSync({
      payload: {
        features: {
          feature: {
            defaultValue: false,
          },
        },
      },
    });

    const user: UserContext = {
      attributes: {
        id: "1",
      },
    };

    const res = gb.evalFeature("feature", user);

    expect(track).toHaveBeenCalledWith("feature", res, user);

    gb.destroy();
  });

  it("Supports sticky buckets", async () => {
    const stickyBucketService = new LocalStorageStickyBucketService();

    const exp: FeatureRule = {
      variations: [false, true],
      hashAttribute: "id",
      hashVersion: 2,
      weights: [0, 1],
      meta: [{ key: "control" }, { key: "variation1" }],
    };

    const gb = new GrowthBookClient();
    gb.initSync({
      payload: {
        features: {
          feature: {
            defaultValue: false,
            rules: [exp],
          },
        },
      },
    });

    const user: UserContext = await gb.applyStickyBuckets(
      {
        attributes: {
          id: "1",
        },
      },
      stickyBucketService
    );
    // Starts out empty
    expect(user.stickyBucketAssignmentDocs).toEqual({});

    // After evaluating a feature, it gets saved back to the user context
    gb.isOn("feature", user);

    const newStickyBucketDocs = {
      "id||1": {
        assignments: {
          feature__0: "variation1",
        },
        attributeName: "id",
        attributeValue: "1",
      },
    };

    expect(user.stickyBucketAssignmentDocs).toEqual(newStickyBucketDocs);

    // New user contexts with the same id pick up the saved bucket
    const user2: UserContext = await gb.applyStickyBuckets(
      {
        attributes: {
          id: "1",
        },
      },
      stickyBucketService
    );
    expect(user2.stickyBucketAssignmentDocs).toEqual(newStickyBucketDocs);

    // New user contexts with different ids don't pick up the saved bucket
    const user3: UserContext = await gb.applyStickyBuckets(
      {
        attributes: {
          id: "2",
        },
      },
      stickyBucketService
    );
    expect(user3.stickyBucketAssignmentDocs).toEqual({});

    // If the experiment weights change, the sticky bucket continues to work
    exp.weights = [1, 0];
    await gb.setPayload({
      features: {
        feature: {
          defaultValue: false,
          rules: [exp],
        },
      },
    });
    expect(gb.isOn("feature", user)).toEqual(true);
    expect(gb.isOn("feature", user2)).toEqual(true);
    expect(gb.isOn("feature", user3)).toEqual(false);

    localStorage.clear();
    gb.destroy();
  });

  describe("Merges user and global context fields", () => {
    const exp: Experiment<boolean> = {
      key: "my-experiment",
      variations: [false, true],
      hashVersion: 2,
      hashAttribute: "id",
      weights: [1, 0],
    };
    const user: UserContext = {
      attributes: {
        id: "1",
      },
    };

    it("Merges enabled flag", () => {
      const gb = new GrowthBookClient().initSync({ payload: {} });
      const gbDisabled = new GrowthBookClient({
        enabled: false,
      }).initSync({ payload: {} });

      expect(gb.runInlineExperiment(exp, user).inExperiment).toEqual(true);
      expect(
        gb.runInlineExperiment(exp, { ...user, enabled: false }).inExperiment
      ).toEqual(false);
      expect(gbDisabled.runInlineExperiment(exp, user).inExperiment).toEqual(
        false
      );
      expect(
        gbDisabled.runInlineExperiment(exp, { ...user, enabled: false })
          .inExperiment
      ).toEqual(false);

      gb.destroy();
      gbDisabled.destroy();
    });

    it("Merges qaMode flag", () => {
      const gb = new GrowthBookClient().initSync({ payload: {} });
      const gbQA = new GrowthBookClient({
        qaMode: true,
      }).initSync({ payload: {} });

      expect(gb.runInlineExperiment(exp, user).inExperiment).toEqual(true);
      expect(
        gb.runInlineExperiment(exp, { ...user, qaMode: true }).inExperiment
      ).toEqual(false);
      expect(gbQA.runInlineExperiment(exp, user).inExperiment).toEqual(false);
      expect(
        gbQA.runInlineExperiment(exp, { ...user, qaMode: true }).inExperiment
      ).toEqual(false);

      gb.destroy();
      gbQA.destroy();
    });

    it("Merges forcedVariations", () => {
      const gb = new GrowthBookClient().initSync({ payload: {} });
      const gbForced = new GrowthBookClient({
        forcedVariations: { "my-experiment": 1 },
      }).initSync({ payload: {} });

      expect(
        gb.runInlineExperiment(exp, {
          ...user,
          forcedVariations: { "my-other-experiment": 1 },
        }).variationId
      ).toEqual(0);
      expect(
        gb.runInlineExperiment(exp, {
          ...user,
          forcedVariations: { "my-experiment": 1 },
        }).variationId
      ).toEqual(1);
      expect(
        gbForced.runInlineExperiment(exp, {
          ...user,
          forcedVariations: { "my-other-experiment": 1 },
        }).variationId
      ).toEqual(1);
      expect(
        gbForced.runInlineExperiment(exp, {
          ...user,
          forcedVariations: { "my-experiment": 1 },
        }).variationId
      ).toEqual(1);
      expect(
        gbForced.runInlineExperiment(exp, {
          ...user,
          forcedVariations: { "my-experiment": 0 },
        }).variationId
      ).toEqual(0);

      gb.destroy();
      gbForced.destroy();
    });

    it("Merges forcedFeatureValues", () => {
      const payload: FeatureApiResponse = {
        features: {
          feature: {
            defaultValue: false,
          },
        },
      };
      const force = new Map([["feature", true]]);
      const forceOff = new Map([["feature", false]]);
      const otherForce = new Map([["other-feature", true]]);

      const gb = new GrowthBookClient().initSync({ payload });
      const gbForced = new GrowthBookClient({
        forcedFeatureValues: force,
      }).initSync({ payload });

      expect(
        gb.evalFeature("feature", {
          ...user,
          forcedFeatureValues: otherForce,
        }).value
      ).toEqual(false);
      expect(
        gb.evalFeature("feature", {
          ...user,
          forcedFeatureValues: force,
        }).value
      ).toEqual(true);
      expect(
        gbForced.evalFeature("feature", {
          ...user,
          forcedFeatureValues: otherForce,
        }).value
      ).toEqual(true);
      expect(
        gbForced.evalFeature("feature", {
          ...user,
          forcedFeatureValues: force,
        }).value
      ).toEqual(true);
      expect(
        gbForced.evalFeature("feature", {
          ...user,
          forcedFeatureValues: forceOff,
        }).value
      ).toEqual(false);

      gb.destroy();
      gbForced.destroy();
    });

    it("Merges trackingCallback", () => {
      const track = jest.fn();
      const track2 = jest.fn();
      const track3 = jest.fn();
      const track4 = jest.fn();

      // Only user trackingCallback
      const gb = new GrowthBookClient().initSync({ payload: {} });
      gb.runInlineExperiment(exp, {
        ...user,
        trackingCallback: track,
      });
      expect(track).toHaveBeenCalled();

      // Only global trackingCallback
      const gb2 = new GrowthBookClient({
        trackingCallback: track2,
      }).initSync({ payload: {} });
      gb2.runInlineExperiment(exp, user);
      expect(track2).toHaveBeenCalled();

      // Both
      const gb3 = new GrowthBookClient({
        trackingCallback: track3,
      }).initSync({ payload: {} });
      gb3.runInlineExperiment(exp, {
        ...user,
        trackingCallback: track4,
      });
      expect(track3).toHaveBeenCalled();
      expect(track4).toHaveBeenCalled();

      gb.destroy();
      gb2.destroy();
      gb3.destroy();
    });

    it("Merges onFeatureUsage", () => {
      const track = jest.fn();
      const track2 = jest.fn();
      const track3 = jest.fn();
      const track4 = jest.fn();

      const payload: FeatureApiResponse = {
        features: {
          feature: {
            defaultValue: false,
          },
        },
      };

      // Only user onFeatureUsage
      const gb = new GrowthBookClient().initSync({ payload });
      gb.evalFeature("feature", {
        ...user,
        onFeatureUsage: track,
      });
      expect(track).toHaveBeenCalled();

      // Only global onFeatureUsage
      const gb2 = new GrowthBookClient({
        onFeatureUsage: track2,
      }).initSync({ payload });
      gb2.evalFeature("feature", user);
      expect(track2).toHaveBeenCalled();

      // Both
      const gb3 = new GrowthBookClient({
        onFeatureUsage: track3,
      }).initSync({ payload });
      gb3.evalFeature("feature", {
        ...user,
        onFeatureUsage: track4,
      });
      expect(track3).toHaveBeenCalled();
      expect(track4).toHaveBeenCalled();

      gb.destroy();
      gb2.destroy();
      gb3.destroy();
    });
    it("Merges globalAttributes and attributes", () => {
      const gb = new GrowthBookClient().initSync({
        payload: {
          features: {
            feature: {
              defaultValue: false,
              rules: [
                {
                  condition: { country: "US" },
                  force: true,
                },
              ],
            },
          },
        },
      });

      // User attributes only
      expect(
        gb.isOn("feature", {
          attributes: {
            country: "US",
          },
        })
      ).toEqual(true);

      // Global attributes only
      gb.setGlobalAttributes({
        country: "US",
      });
      expect(
        gb.isOn("feature", {
          attributes: {},
        })
      ).toEqual(true);

      // Both
      expect(
        gb.isOn("feature", {
          attributes: {
            country: "US",
          },
        })
      ).toEqual(true);

      // User overrides global
      expect(
        gb.isOn("feature", {
          attributes: {
            country: "GB",
          },
        })
      ).toEqual(false);

      gb.destroy();
    });
  });
});

describe("UserScopedGrowthBook", () => {
  it("Supports basic feature evaluation with scoped instance", () => {
    const gb = new GrowthBookClient();
    gb.initSync({
      payload: {
        features: {
          feature: {
            defaultValue: false,
            rules: [
              {
                condition: { country: "US" },
                force: true,
              },
            ],
          },
        },
      },
    });

    const experiment: Experiment<boolean> = {
      key: "exp",
      variations: [false, true],
      condition: { country: "US" },
      weights: [0, 1],
    };

    const scoped = gb.createScopedInstance({
      attributes: {
        id: "1",
        country: "US",
      },
    });

    expect(scoped.isOn("feature")).toEqual(true);
    expect(scoped.isOff("feature")).toEqual(false);
    expect(scoped.getFeatureValue("feature", false)).toEqual(true);
    expect(scoped.evalFeature("feature").value).toEqual(true);
    expect(scoped.runInlineExperiment(experiment).variationId).toEqual(1);

    const scoped2 = gb.createScopedInstance({
      attributes: {
        id: "1",
        country: "GB",
      },
    });

    expect(scoped2.isOn("feature")).toEqual(false);
    expect(scoped2.isOff("feature")).toEqual(true);
    expect(scoped2.getFeatureValue("feature", true)).toEqual(false);
    expect(scoped2.evalFeature("feature").value).toEqual(false);
    expect(scoped2.runInlineExperiment(experiment).variationId).toEqual(0);

    gb.destroy();
  });
});
