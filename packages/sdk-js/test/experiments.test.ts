import { GrowthBook } from "../src";
import { Context, Experiment } from "../src/types/growthbook";

Object.defineProperty(window, "location", {
  value: {
    ...window.location,
  },
  writable: true,
});

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
const mockCallback = (context: Context) => {
  const onExperimentViewed = jest.fn((a) => {
    return a;
  });
  context.trackingCallback = onExperimentViewed;

  return onExperimentViewed.mock;
};

describe("experiments", () => {
  beforeEach(() => {
    window.location.href = "";
  });

  it("tracking", () => {
    const context: Context = { user: { id: "1" } };
    const growthbook = new GrowthBook(context);
    const mock = mockCallback(context);

    const exp1: Experiment<number> = {
      key: "my-tracked-test",
      variations: [0, 1],
    };
    const exp2: Experiment<number> = {
      key: "my-other-tracked-test",
      variations: [0, 1],
    };

    const res1 = growthbook.run(exp1);
    growthbook.run(exp1);
    growthbook.run(exp1);
    const res4 = growthbook.run(exp2);
    context.user = { id: "2" };
    const res5 = growthbook.run(exp2);

    expect(mock.calls.length).toEqual(3);
    expect(mock.calls[0]).toEqual([exp1, res1]);
    expect(mock.calls[1]).toEqual([exp2, res4]);
    expect(mock.calls[2]).toEqual([exp2, res5]);

    growthbook.destroy();
  });

  it("handles weird experiment values", () => {
    const context: Context = { user: { id: "1" } };
    const growthbook = new GrowthBook(context);
    const spy = jest.spyOn(console, "error").mockImplementation();

    expect(
      growthbook.run({
        key: "my-test",
        variations: [0, 1],
        include: () => {
          throw new Error("Blah");
        },
      }).inExperiment
    ).toEqual(false);

    // Should fail gracefully
    context.trackingCallback = () => {
      throw new Error("Blah");
    };
    expect(
      growthbook.run({ key: "my-test", variations: [0, 1] }).value
    ).toEqual(1);

    growthbook.subscribe(() => {
      throw new Error("Blah");
    });
    expect(
      growthbook.run({ key: "my-new-test", variations: [0, 1] }).value
    ).toEqual(0);

    spy.mockRestore();

    growthbook.destroy();
  });

  it("logs debug message", () => {
    const spy = jest.spyOn(console, "log").mockImplementation();

    const context: Context = { user: { id: "1" } };
    const growthbook = new GrowthBook(context);
    growthbook.run({
      key: "my-test",
      variations: [0, 1],
    });

    // Does not log normally
    expect(spy.mock.calls.length).toEqual(0);

    // Logs when in debug mode
    growthbook.debug = true;
    growthbook.run({
      key: "my-test2",
      variations: [0, 1],
    });
    // Should be
    // 1. In experiment
    expect(spy.mock.calls.length).toEqual(1);

    growthbook.debug = false;
    spy.mockRestore();
    growthbook.destroy();
  });

  it("uses window.location.href by default", () => {
    window.location.href = "http://example.com/path";
    const context: Context = { user: { id: "1" } };
    const growthbook = new GrowthBook(context);
    expect(
      growthbook.run({
        key: "my-test",
        variations: [0, 1],
        url: /^\/path/,
      }).inExperiment
    ).toEqual(true);
    expect(
      growthbook.run({
        key: "my-test",
        variations: [0, 1],
        url: /^\/bath/,
      }).inExperiment
    ).toEqual(false);

    growthbook.destroy();
  });

  it("forces variation from overrides", () => {
    const growthbook = new GrowthBook({
      attributes: {
        id: "6",
      },
      overrides: {
        "forced-test": {
          force: 1,
        },
      },
    });

    const res = growthbook.run({
      key: "forced-test",
      variations: [0, 1],
    });

    expect(res.variationId).toEqual(1);
    expect(res.inExperiment).toEqual(true);
    expect(res.hashUsed).toEqual(false);

    growthbook.destroy();
  });

  it("coverrage from overrides", () => {
    const growthbook = new GrowthBook({
      attributes: {
        id: "1",
      },
      overrides: {
        "my-test": {
          coverage: 0.01,
        },
      },
    });

    const res = growthbook.run({
      key: "my-test",
      variations: [0, 1],
    });

    expect(res.variationId).toEqual(0);
    expect(res.inExperiment).toEqual(false);

    growthbook.destroy();
  });

  it("coverrage from overrides", () => {
    const growthbook = new GrowthBook({
      attributes: {
        id: "1",
      },
      overrides: {
        "my-test": {
          coverage: 0.01,
        },
      },
    });

    const res = growthbook.run({
      key: "my-test",
      variations: [0, 1],
    });

    expect(res.variationId).toEqual(0);
    expect(res.inExperiment).toEqual(false);

    growthbook.destroy();
  });

  it("does not track when forced with overrides", () => {
    const context: Context = { user: { id: "6" } };
    const growthbook = new GrowthBook(context);
    const exp: Experiment<number> = { key: "forced-test", variations: [0, 1] };

    const mock = mockCallback(context);
    context.overrides = {
      "forced-test": {
        force: 1,
      },
    };
    growthbook.run(exp);
    expect(mock.calls.length).toEqual(0);

    growthbook.destroy();
  });

  it("url from overrides", () => {
    const context: Context = {
      user: { id: "1" },
      overrides: {
        "my-test": {
          url: /^\/path/,
        },
      },
    };
    const growthbook = new GrowthBook(context);
    expect(
      growthbook.run({
        key: "my-test",
        variations: [0, 1],
      }).inExperiment
    ).toEqual(false);

    growthbook.destroy();
  });

  it("filters user groups", () => {
    const growthbook = new GrowthBook({
      user: { id: "123" },
      groups: {
        alpha: true,
        beta: true,
        internal: false,
        qa: false,
      },
    });

    expect(
      growthbook.run({
        key: "my-test",
        variations: [0, 1],
        groups: ["internal", "qa"],
      }).inExperiment
    ).toEqual(false);

    expect(
      growthbook.run({
        key: "my-test",
        variations: [0, 1],
        groups: ["internal", "qa", "beta"],
      }).inExperiment
    ).toEqual(true);

    expect(
      growthbook.run({
        key: "my-test",
        variations: [0, 1],
      }).inExperiment
    ).toEqual(true);

    growthbook.destroy();
  });

  it("sets attributes", () => {
    const attributes = {
      id: "1",
      browser: "firefox",
    };
    const growthbook = new GrowthBook();

    growthbook.setAttributes(attributes);

    expect(growthbook.getAttributes()).toEqual(attributes);

    growthbook.destroy();
  });

  it("runs custom include callback", () => {
    const context: Context = { user: { id: "1" } };
    const growthbook = new GrowthBook(context);
    expect(
      growthbook.run({
        key: "my-test",
        variations: [0, 1],
        include: () => false,
      }).inExperiment
    ).toEqual(false);

    growthbook.destroy();
  });

  it("tracking skipped when context disabled", () => {
    const context: Context = { user: { id: "1" }, enabled: false };
    const growthbook = new GrowthBook(context);
    const mock = mockCallback(context);

    growthbook.run({ key: "disabled-test", variations: [0, 1] });

    expect(mock.calls.length).toEqual(0);

    growthbook.destroy();
  });

  it("querystring force disabled tracking", () => {
    const context: Context = {
      user: { id: "1" },
      url: "http://example.com?forced-test-qs=1",
    };
    const growthbook = new GrowthBook(context);
    const mock = mockCallback(context);
    const exp: Experiment<number> = {
      key: "forced-test-qs",
      variations: [0, 1],
    };
    growthbook.run(exp);
    expect(mock.calls.length).toEqual(0);

    growthbook.destroy();
  });

  it("url targeting", () => {
    const context: Context = {
      user: { id: "1" },
      url: "http://example.com",
    };
    const growthbook = new GrowthBook(context);
    const exp: Experiment<number> = {
      key: "my-test",
      variations: [0, 1],
      url: /^\/post\/[0-9]+/,
    };

    expect(growthbook.run(exp)).toMatchObject({
      inExperiment: false,
      value: 0,
    });

    context.url = "http://example.com/post/123";
    expect(growthbook.run(exp)).toMatchObject({
      inExperiment: true,
      value: 1,
    });

    exp.url = /http:\/\/example.com\/post\/[0-9]+/;
    expect(growthbook.run(exp)).toMatchObject({
      inExperiment: true,
      value: 1,
    });

    growthbook.destroy();
  });

  it("invalid url regex", () => {
    const growthbook = new GrowthBook({
      user: { id: "1" },
      overrides: {
        "my-test": {
          url: "???***[)",
        },
      },
      url: "http://example.com",
    });
    const spy = jest.spyOn(console, "error").mockImplementation();

    expect(
      growthbook.run({
        key: "my-test",
        variations: [0, 1],
      }).value
    ).toEqual(1);

    spy.mockRestore();

    growthbook.destroy();
  });

  it("ignores draft experiments", () => {
    const context: Context = { user: { id: "1" } };
    const growthbook = new GrowthBook(context);
    const exp: Experiment<number> = {
      key: "my-test",
      status: "draft",
      variations: [0, 1],
    };

    const res1 = growthbook.run(exp);
    context.url = "http://example.com/?my-test=1";
    const res2 = growthbook.run(exp);

    expect(res1.inExperiment).toEqual(false);
    expect(res1.hashUsed).toEqual(false);
    expect(res1.value).toEqual(0);
    expect(res2.inExperiment).toEqual(true);
    expect(res2.hashUsed).toEqual(false);
    expect(res2.value).toEqual(1);

    growthbook.destroy();
  });

  it("ignores stopped experiments unless forced", () => {
    const context: Context = { user: { id: "1" } };
    const growthbook = new GrowthBook(context);
    const expLose: Experiment<number> = {
      key: "my-test",
      status: "stopped",
      variations: [0, 1, 2],
    };
    const expWin: Experiment<number> = {
      key: "my-test",
      status: "stopped",
      variations: [0, 1, 2],
      force: 2,
    };

    const res1 = growthbook.run(expLose);
    const res2 = growthbook.run(expWin);

    expect(res1.value).toEqual(0);
    expect(res1.inExperiment).toEqual(false);
    expect(res1.hashUsed).toEqual(false);
    expect(res2.value).toEqual(2);
    expect(res2.inExperiment).toEqual(true);
    expect(res2.hashUsed).toEqual(false);

    growthbook.destroy();
  });

  it("destroy removes subscriptions", () => {
    const context: Context = { user: { id: "1" } };
    const growthbook = new GrowthBook(context);
    let fired = false;
    growthbook.subscribe(() => {
      fired = true;
    });

    growthbook.run({
      key: "my-test",
      variations: [0, 1],
    });
    expect(fired).toEqual(true);

    fired = false;
    growthbook.destroy();

    growthbook.run({
      key: "my-other-test",
      variations: [0, 1],
    });
    expect(fired).toEqual(false);

    growthbook.destroy();
  });

  it("does even weighting", () => {
    const context: Context = {};
    const growthbook = new GrowthBook(context);
    // Full coverage
    const exp: Experiment<number> = { key: "my-test", variations: [0, 1] };
    let variations: Record<string, number> = {
      "0": 0,
      "1": 0,
      "-1": 0,
    };
    for (let i = 0; i < 1000; i++) {
      context.user = { id: i + "" };
      const res = growthbook.run(exp);
      const v = res.inExperiment ? res.value : -1;
      variations[v]++;
    }
    expect(variations["0"]).toEqual(503);

    // Reduced coverage
    exp.coverage = 0.4;
    variations = {
      "0": 0,
      "1": 0,
      "-1": 0,
    };
    for (let i = 0; i < 10000; i++) {
      context.user = { id: i + "" };
      const res = growthbook.run(exp);
      const v = res.inExperiment ? res.value : -1;
      variations[v]++;
    }
    expect(variations["0"]).toEqual(2044);
    expect(variations["1"]).toEqual(1980);
    expect(variations["-1"]).toEqual(5976);

    // 3-way
    exp.coverage = 0.6;
    exp.variations = [0, 1, 2];
    variations = {
      "0": 0,
      "1": 0,
      "2": 0,
      "-1": 0,
    };
    for (let i = 0; i < 10000; i++) {
      context.user = { id: i + "" };
      const res = growthbook.run(exp);
      const v = res.inExperiment ? res.value : -1;
      variations[v]++;
    }
    expect(variations).toEqual({
      "-1": 3913,
      "0": 2044,
      "1": 2000,
      "2": 2043,
    });

    growthbook.destroy();
  });

  it("forces multiple variations at once", () => {
    const growthbook = new GrowthBook({ attributes: { id: "1" } });
    const exp: Experiment<number> = {
      key: "my-test",
      variations: [0, 1],
    };
    const res1 = growthbook.run(exp);
    expect(res1.inExperiment).toEqual(true);
    expect(res1.hashUsed).toEqual(true);
    expect(res1.value).toEqual(1);

    growthbook.setForcedVariations({
      "my-test": 0,
    });

    const res2 = growthbook.run(exp);
    expect(res2.inExperiment).toEqual(true);
    expect(res2.hashUsed).toEqual(false);
    expect(res2.value).toEqual(0);

    growthbook.setForcedVariations({});
    const res3 = growthbook.run(exp);
    expect(res3.inExperiment).toEqual(true);
    expect(res3.hashUsed).toEqual(true);
    expect(res3.value).toEqual(1);

    growthbook.destroy();
  });

  it("forces all variations to -1 in qa mode", () => {
    const context: Context = { user: { id: "1" }, qaMode: true };
    const growthbook = new GrowthBook(context);
    const exp: Experiment<number> = {
      key: "my-test",
      variations: [0, 1],
    };

    const res1 = growthbook.run(exp);
    expect(res1.inExperiment).toEqual(false);
    expect(res1.hashUsed).toEqual(false);
    expect(res1.value).toEqual(0);

    // Still works if explicitly forced
    context.forcedVariations = { "my-test": 1 };
    const res2 = growthbook.run(exp);
    expect(res2.inExperiment).toEqual(true);
    expect(res2.hashUsed).toEqual(false);
    expect(res2.value).toEqual(1);

    // Works if the experiment itself is forced
    const res3 = growthbook.run({
      key: "my-test-2",
      variations: [0, 1],
      force: 1,
    });
    expect(res3.inExperiment).toEqual(true);
    expect(res3.hashUsed).toEqual(false);
    expect(res3.value).toEqual(1);

    growthbook.destroy();
  });

  it("fires subscriptions correctly", () => {
    const growthbook = new GrowthBook({
      user: {
        id: "1",
      },
    });

    let fired = false;
    const unsubscriber = growthbook.subscribe(() => {
      fired = true;
    });
    expect(fired).toEqual(false);

    const exp: Experiment<number> = {
      key: "my-test",
      variations: [0, 1],
    };

    // Should fire when user is put in an experiment
    growthbook.run(exp);
    expect(fired).toEqual(true);

    // Does not fire if nothing has changed
    fired = false;
    growthbook.run(exp);
    expect(fired).toEqual(false);

    // Does not fire after unsubscribed
    unsubscriber();
    growthbook.run({
      key: "other-test",
      variations: [0, 1],
    });
    expect(fired).toEqual(false);

    growthbook.destroy();
  });

  it("stores assigned variations in the user", () => {
    const growthbook = new GrowthBook({
      user: {
        id: "1",
      },
    });
    growthbook.run({ key: "my-test", variations: [0, 1] });
    growthbook.run({ key: "my-test-3", variations: [0, 1] });

    const assigned = growthbook.getAllResults();
    const assignedArr: { e: string; v: number }[] = [];
    assigned.forEach((v, e) => {
      assignedArr.push({ e, v: v.result.variationId });
    });

    expect(assignedArr.length).toEqual(2);
    expect(assignedArr[0].e).toEqual("my-test");
    expect(assignedArr[0].v).toEqual(1);
    expect(assignedArr[1].e).toEqual("my-test-3");
    expect(assignedArr[1].v).toEqual(0);

    growthbook.destroy();
  });

  it("renders when a variation is forced", () => {
    const context: Context = {
      user: { id: "1" },
    };
    const growthbook = new GrowthBook(context);
    let called = false;
    growthbook.setRenderer(() => {
      called = true;
    });

    expect(called).toEqual(false);
    growthbook.forceVariation("my-test", 1);
    expect(context.forcedVariations).toEqual({ "my-test": 1 });
    expect(called).toEqual(true);

    growthbook.destroy();
  });

  it("renders when attributes are updated", async () => {
    const context: Context = {
      user: { id: "1" },
    };
    const growthbook = new GrowthBook(context);
    let called = false;
    growthbook.setRenderer(() => {
      called = true;
    });

    expect(called).toEqual(false);
    growthbook.setAttributes({ id: "2" });
    await sleep(1);
    expect(called).toEqual(true);

    growthbook.destroy();
  });

  it("stores growthbook instance in window when enableDevMode is true", () => {
    const context: Context = {
      enableDevMode: true,
    };
    const growthbook = new GrowthBook(context);

    expect(window._growthbook).toEqual(growthbook);

    growthbook.destroy();

    expect(window._growthbook).toBeUndefined();
  });

  it("does not store growthbook in window by default", () => {
    const context: Context = {};
    const growthbook = new GrowthBook(context);

    expect(window._growthbook).toBeUndefined();

    growthbook.destroy();
  });

  it("does not have bias when using namespaces", () => {
    const context: Context = {
      user: {
        id: "1",
      },
    };
    const growthbook = new GrowthBook(context);

    const variations: { [key: string]: number } = {
      "0": 0,
      "1": 0,
      "-1": 0,
    };
    for (let i = 0; i < 10000; i++) {
      context.user = { id: i + "" };
      const res = growthbook.run({
        key: "my-test",
        variations: ["0", "1"],
        namespace: ["namespace", 0, 0.5],
      });
      const v = res.inExperiment ? res.value : "-1";
      variations[v]++;
    }

    expect(variations).toEqual({
      "-1": 4973,
      "0": 2538,
      "1": 2489,
    });

    growthbook.destroy();
  });
});
