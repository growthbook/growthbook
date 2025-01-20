import { Experiment, GrowthBook } from "../../src";
import { thirdPartyTrackingPlugin } from "../../src/plugins/third-party-tracking";

declare global {
  interface Window {
    dataLayer?: unknown[];
    analytics?: {
      track?: (name: string, props?: Record<string, unknown>) => void;
    };
    gtag?: (...args: unknown[]) => void;
  }
}

describe("thirdPartyTrackingPlugin", () => {
  it("should call additionalCallback if provided", async () => {
    const additionalCallback = jest.fn();
    const plugin = thirdPartyTrackingPlugin({
      additionalCallback,
      trackers: [],
    });

    const gb = new GrowthBook({
      plugins: [plugin],
      attributes: {
        id: "123",
      },
    });

    const exp: Experiment<boolean> = {
      key: "my-experiment",
      variations: [false, true],
    };
    const res = gb.run(exp);

    expect(additionalCallback).toHaveBeenCalledWith(exp, res);

    gb.destroy();
  });
  it("should call gtag if enabled", async () => {
    const plugin = thirdPartyTrackingPlugin({
      trackers: ["gtag"],
    });

    window.gtag = jest.fn();

    const gb = new GrowthBook({
      plugins: [plugin],
      attributes: {
        id: "123",
      },
    });

    const exp: Experiment<boolean> = {
      key: "my-experiment",
      variations: [false, true],
    };
    const res = gb.run(exp);

    expect(window.gtag).toHaveBeenCalledWith("event", "experiment_viewed", {
      experiment_id: exp.key,
      variation_id: res.key,
      event_callback: expect.any(Function),
    });

    delete window.gtag;
    gb.destroy();
  });
  it("should call gtm if enabled", async () => {
    const plugin = thirdPartyTrackingPlugin({
      trackers: ["gtag", "gtm"],
    });

    window.dataLayer = [];

    const gb = new GrowthBook({
      plugins: [plugin],
      attributes: {
        id: "123",
      },
    });

    const exp: Experiment<boolean> = {
      key: "my-experiment",
      variations: [false, true],
    };
    const res = gb.run(exp);

    expect(window.dataLayer).toEqual([
      {
        event: "experiment_viewed",
        experiment_id: exp.key,
        variation_id: res.key,
        eventCallback: expect.any(Function),
      },
    ]);

    delete window.dataLayer;
    gb.destroy();
  });
  it("should call segment if enabled", async () => {
    const plugin = thirdPartyTrackingPlugin({
      trackers: ["segment"],
    });

    window.analytics = {
      track: jest.fn(),
    };

    const gb = new GrowthBook({
      plugins: [plugin],
      attributes: {
        id: "123",
      },
    });

    const exp: Experiment<boolean> = {
      key: "my-experiment",
      variations: [false, true],
    };
    const res = gb.run(exp);

    expect(window.analytics.track).toHaveBeenCalledWith("Experiment Viewed", {
      experiment_id: exp.key,
      variation_id: res.key,
    });

    delete window.analytics;
    gb.destroy();
  });

  it("Fails silently if trackers don't exist", () => {
    delete window.dataLayer;

    const plugin = thirdPartyTrackingPlugin();

    const gb = new GrowthBook({
      plugins: [plugin],
      attributes: {
        id: "123",
      },
    });

    const exp: Experiment<boolean> = {
      key: "my-experiment",
      variations: [false, true],
    };
    gb.run(exp);

    // Expect window.dataLayer to not have been created
    expect(window.dataLayer).toBeUndefined();

    gb.destroy();
  });
});
