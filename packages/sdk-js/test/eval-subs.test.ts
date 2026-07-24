import { GrowthBook } from "../src";

describe("eval subscriptions", () => {
  describe("_onFeatureEval", () => {
    it("fires on feature evaluation with correct args", () => {
      const cb = jest.fn();
      const gb = new GrowthBook({
        features: { flag: { defaultValue: true } },
      });
      gb._onFeatureEval(cb);

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
      gb._onFeatureEval(cb);

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
      gb._onFeatureEval(cb);

      gb.evalFeature("flag");
      gb.setFeatures({ flag: { defaultValue: "b" } });
      gb.evalFeature("flag");

      expect(cb).toHaveBeenCalledTimes(2);
      expect(cb.mock.calls[1][1]).toEqual(
        expect.objectContaining({ value: "b" }),
      );

      gb.destroy();
    });

    it("unsubscribe stops callbacks", () => {
      const cb = jest.fn();
      const gb = new GrowthBook({
        features: { flag: { defaultValue: 1 } },
      });
      const unsub = gb._onFeatureEval(cb);

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
      gb._onFeatureEval(bad);
      gb._onFeatureEval(good);

      const spy = jest.spyOn(console, "error").mockImplementation(() => {});
      gb.evalFeature("flag");
      spy.mockRestore();

      expect(bad).toHaveBeenCalledTimes(1);
      expect(good).toHaveBeenCalledTimes(1);

      gb.destroy();
    });
  });

  describe("_onEvent", () => {
    it("fires on logEvent with correct args", async () => {
      const cb = jest.fn();
      const gb = new GrowthBook({
        eventLogger: jest.fn(),
      });
      gb._onEvent(cb);

      await gb.logEvent("purchase", { amount: 50 });

      expect(cb).toHaveBeenCalledTimes(1);
      expect(cb).toHaveBeenCalledWith("purchase", { amount: 50 });

      gb.destroy();
    });

    it("fires with undefined properties when none provided", async () => {
      const cb = jest.fn();
      const gb = new GrowthBook({
        eventLogger: jest.fn(),
      });
      gb._onEvent(cb);

      await gb.logEvent("click");

      expect(cb).toHaveBeenCalledWith("click", undefined);

      gb.destroy();
    });

    it("unsubscribe stops callbacks", async () => {
      const cb = jest.fn();
      const gb = new GrowthBook({
        eventLogger: jest.fn(),
      });
      const unsub = gb._onEvent(cb);

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
      gb._onEvent(bad);
      gb._onEvent(good);

      const spy = jest.spyOn(console, "error").mockImplementation(() => {});
      await gb.logEvent("evt");
      spy.mockRestore();

      expect(bad).toHaveBeenCalledTimes(1);
      expect(good).toHaveBeenCalledTimes(1);

      gb.destroy();
    });
  });

  describe("destroy cleanup", () => {
    it("feature eval callbacks do not fire after destroy", () => {
      const cb = jest.fn();
      const gb = new GrowthBook({
        features: { flag: { defaultValue: true } },
      });
      gb._onFeatureEval(cb);
      gb.destroy();

      gb.evalFeature("flag");
      expect(cb).not.toHaveBeenCalled();
    });

    it("event callbacks do not fire after destroy", async () => {
      const cb = jest.fn();
      const gb = new GrowthBook({
        eventLogger: jest.fn(),
      });
      gb._onEvent(cb);
      gb.destroy();

      const spy = jest.spyOn(console, "error").mockImplementation(() => {});
      await gb.logEvent("evt");
      spy.mockRestore();
      expect(cb).not.toHaveBeenCalled();
    });
  });
});
