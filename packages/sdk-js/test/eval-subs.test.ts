import { GrowthBook } from "../src";

describe("eval subscriptions", () => {
  describe("_subscribeFeatureUsage", () => {
    it("fires on feature evaluation with correct args", () => {
      const cb = jest.fn();
      const gb = new GrowthBook({
        features: { flag: { defaultValue: true } },
      });
      gb._subscribeFeatureUsage(cb);

      gb.evalFeature("flag");

      expect(cb).toHaveBeenCalledTimes(1);
      expect(cb).toHaveBeenCalledWith(
        "flag",
        expect.objectContaining({ value: true }),
      );

      gb.destroy();
    });

    it("does not fire for duplicate evaluations", () => {
      const cb = jest.fn();
      const gb = new GrowthBook({
        features: { flag: { defaultValue: "a" } },
      });
      gb._subscribeFeatureUsage(cb);

      gb.evalFeature("flag");
      gb.evalFeature("flag");

      expect(cb).toHaveBeenCalledTimes(1);

      gb.destroy();
    });

    it("fires again when the evaluated value changes", () => {
      const cb = jest.fn();
      const gb = new GrowthBook({
        features: { flag: { defaultValue: "a" } },
      });
      gb._subscribeFeatureUsage(cb);

      gb.evalFeature("flag");
      gb.setFeatures({ flag: { defaultValue: "b" } });
      gb.evalFeature("flag");

      expect(cb).toHaveBeenCalledTimes(2);
      expect(cb.mock.calls[1][1]).toEqual(
        expect.objectContaining({ value: "b" }),
      );

      gb.destroy();
    });

    it("does not fire when value is the same but metadata differs", () => {
      const cb = jest.fn();
      const gb = new GrowthBook({
        features: {
          flag: {
            defaultValue: "v",
            rules: [{ force: "v", condition: { country: "us" } }],
          },
        },
      });
      gb._subscribeFeatureUsage(cb);

      gb.evalFeature("flag");
      expect(cb).toHaveBeenCalledTimes(1);

      gb.setAttributes({ country: "us" });
      gb.evalFeature("flag");
      // Same value "v" even though source/rule changed
      expect(cb).toHaveBeenCalledTimes(1);

      gb.destroy();
    });

    it("does not fire for overridden features", () => {
      const cb = jest.fn();
      const gb = new GrowthBook({
        features: { flag: { defaultValue: "original" } },
      });
      gb.setForcedFeatures(new Map([["flag", "forced"]]));
      gb._subscribeFeatureUsage(cb);

      gb.evalFeature("flag");
      expect(cb).not.toHaveBeenCalled();

      gb.destroy();
    });

    it("unsubscribe stops callbacks", () => {
      const cb = jest.fn();
      const gb = new GrowthBook({
        features: { flag: { defaultValue: 1 } },
      });
      const unsub = gb._subscribeFeatureUsage(cb);

      gb.evalFeature("flag");
      expect(cb).toHaveBeenCalledTimes(1);

      unsub();
      gb.setFeatures({ flag: { defaultValue: 2 } });
      gb.evalFeature("flag");
      expect(cb).toHaveBeenCalledTimes(1);

      gb.destroy();
    });

    it("a throwing callback does not break other subscribers", () => {
      const bad = jest.fn(() => {
        throw new Error("boom");
      });
      const good = jest.fn();
      const gb = new GrowthBook({
        features: { flag: { defaultValue: true } },
      });
      gb._subscribeFeatureUsage(bad);
      gb._subscribeFeatureUsage(good);

      const spy = jest.spyOn(console, "error").mockImplementation(() => {});
      gb.evalFeature("flag");
      spy.mockRestore();

      expect(bad).toHaveBeenCalledTimes(1);
      expect(good).toHaveBeenCalledTimes(1);

      gb.destroy();
    });
  });

  describe("_subscribeCustomEvents", () => {
    it("fires on logEvent with correct args", async () => {
      const cb = jest.fn();
      const gb = new GrowthBook({
        eventLogger: jest.fn(),
      });
      gb._subscribeCustomEvents(cb);

      await gb.logEvent("purchase", { amount: 50 });

      expect(cb).toHaveBeenCalledTimes(1);
      expect(cb).toHaveBeenCalledWith("purchase", { amount: 50 });

      gb.destroy();
    });

    it("normalizes missing properties to empty object", async () => {
      const cb = jest.fn();
      const gb = new GrowthBook({
        eventLogger: jest.fn(),
      });
      gb._subscribeCustomEvents(cb);

      await gb.logEvent("click");

      expect(cb).toHaveBeenCalledWith("click", {});

      gb.destroy();
    });

    it("unsubscribe stops callbacks", async () => {
      const cb = jest.fn();
      const gb = new GrowthBook({
        eventLogger: jest.fn(),
      });
      const unsub = gb._subscribeCustomEvents(cb);

      await gb.logEvent("a");
      expect(cb).toHaveBeenCalledTimes(1);

      unsub();
      await gb.logEvent("b");
      expect(cb).toHaveBeenCalledTimes(1);

      gb.destroy();
    });

    it("a throwing callback does not break other subscribers", async () => {
      const bad = jest.fn(() => {
        throw new Error("boom");
      });
      const good = jest.fn();
      const gb = new GrowthBook({
        eventLogger: jest.fn(),
      });
      gb._subscribeCustomEvents(bad);
      gb._subscribeCustomEvents(good);

      const spy = jest.spyOn(console, "error").mockImplementation(() => {});
      await gb.logEvent("evt");
      spy.mockRestore();

      expect(bad).toHaveBeenCalledTimes(1);
      expect(good).toHaveBeenCalledTimes(1);

      gb.destroy();
    });
  });

  describe("coexistence with existing callbacks", () => {
    it("feature usage sub and onFeatureUsage both fire", () => {
      const sub = jest.fn();
      const onUsage = jest.fn();
      const gb = new GrowthBook({
        features: { flag: { defaultValue: true } },
        onFeatureUsage: onUsage,
      });
      gb._subscribeFeatureUsage(sub);

      gb.evalFeature("flag");

      expect(sub).toHaveBeenCalledTimes(1);
      expect(onUsage).toHaveBeenCalledTimes(1);

      gb.destroy();
    });

    it("custom event sub and eventLogger both fire", async () => {
      const sub = jest.fn();
      const logger = jest.fn();
      const gb = new GrowthBook({
        eventLogger: logger,
      });
      gb._subscribeCustomEvents(sub);

      await gb.logEvent("evt", { a: 1 });

      expect(sub).toHaveBeenCalledTimes(1);
      expect(logger).toHaveBeenCalledTimes(1);

      gb.destroy();
    });

    it("throwing feature sub does not prevent onFeatureUsage", () => {
      const bad = jest.fn(() => {
        throw new Error("boom");
      });
      const onUsage = jest.fn();
      const gb = new GrowthBook({
        features: { flag: { defaultValue: true } },
        onFeatureUsage: onUsage,
      });
      gb._subscribeFeatureUsage(bad);

      const spy = jest.spyOn(console, "error").mockImplementation(() => {});
      gb.evalFeature("flag");
      spy.mockRestore();

      expect(bad).toHaveBeenCalledTimes(1);
      expect(onUsage).toHaveBeenCalledTimes(1);

      gb.destroy();
    });

    it("throwing event sub does not prevent eventLogger", async () => {
      const bad = jest.fn(() => {
        throw new Error("boom");
      });
      const logger = jest.fn();
      const gb = new GrowthBook({
        eventLogger: logger,
      });
      gb._subscribeCustomEvents(bad);

      const spy = jest.spyOn(console, "error").mockImplementation(() => {});
      await gb.logEvent("evt");
      spy.mockRestore();

      expect(bad).toHaveBeenCalledTimes(1);
      expect(logger).toHaveBeenCalledTimes(1);

      gb.destroy();
    });

    it("unsubscribing does not affect existing callbacks", () => {
      const sub = jest.fn();
      const onUsage = jest.fn();
      const gb = new GrowthBook({
        features: { flag: { defaultValue: "a" } },
        onFeatureUsage: onUsage,
      });
      const unsub = gb._subscribeFeatureUsage(sub);

      gb.evalFeature("flag");
      expect(sub).toHaveBeenCalledTimes(1);
      expect(onUsage).toHaveBeenCalledTimes(1);

      unsub();
      gb.setFeatures({ flag: { defaultValue: "b" } });
      gb.evalFeature("flag");
      expect(sub).toHaveBeenCalledTimes(1);
      expect(onUsage).toHaveBeenCalledTimes(2);

      gb.destroy();
    });
  });

  describe("destroy cleanup", () => {
    it("feature usage callbacks do not fire after destroy", () => {
      const cb = jest.fn();
      const gb = new GrowthBook({
        features: { flag: { defaultValue: true } },
      });
      gb._subscribeFeatureUsage(cb);
      gb.destroy();

      gb.evalFeature("flag");
      expect(cb).not.toHaveBeenCalled();
    });

    it("custom event callbacks do not fire after destroy", async () => {
      const cb = jest.fn();
      const gb = new GrowthBook({
        eventLogger: jest.fn(),
      });
      gb._subscribeCustomEvents(cb);
      gb.destroy();

      const spy = jest.spyOn(console, "error").mockImplementation(() => {});
      await gb.logEvent("evt");
      spy.mockRestore();
      expect(cb).not.toHaveBeenCalled();
    });
  });
});
