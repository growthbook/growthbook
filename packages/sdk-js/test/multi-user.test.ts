import {
  Experiment,
  FeatureRule,
  LocalStorageStickyBucketService,
  UserContext,
} from "../src";
import { GrowthBookMultiUser } from "../src/GrowthBookMultiUser";
require("jest-localstorage-mock");

describe("GrowthBookMultiUser", () => {
  it("Supports basic feature evaluation", async () => {
    const gb = new GrowthBookMultiUser();
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
    const gb = new GrowthBookMultiUser({
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

  it("Defers tracking calls until a tracking callback is provided", async () => {
    const track = jest.fn();
    const gb = new GrowthBookMultiUser();

    gb.initSync({ payload: {} });

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

    expect(track).not.toHaveBeenCalled();

    expect(gb.getDeferredTrackingCalls()).toEqual([
      { experiment: exp, result: res, user },
    ]);

    gb.setTrackingCallback(track);

    expect(track).toHaveBeenCalledWith(exp, res, user);

    await new Promise((r) => setTimeout(r, 50));

    expect(gb.getDeferredTrackingCalls()).toEqual([]);

    gb.destroy();
  });

  it("Fires feature usage callback with user", async () => {
    const track = jest.fn();
    const gb = new GrowthBookMultiUser({
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

    const gb = new GrowthBookMultiUser();
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
});
