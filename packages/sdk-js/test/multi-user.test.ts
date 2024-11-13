import { Experiment, UserContext } from "../src";
import { GrowthBookMultiUser } from "../src/GrowthBookMultiUser";

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
});
