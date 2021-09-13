import {
  getQueryStringOverride,
  getBucketRanges,
  chooseVariation,
  hashFnv32a,
} from "../src/util";
import { GrowthBook } from "../src";
import { Experiment } from "../src/types";

Object.defineProperty(window, "location", {
  value: {
    ...window.location,
  },
  writable: true,
});

const mockCallback = (growthbook: GrowthBook) => {
  const onExperimentViewed = jest.fn((a) => {
    return a;
  });
  growthbook.context.trackingCallback = onExperimentViewed;

  return onExperimentViewed.mock;
};

describe("experiments", () => {
  beforeEach(() => {
    window.location.href = "";
  });

  it("defaultWeights", () => {
    const growthbook = new GrowthBook({});

    const exp: Experiment<number> = {
      key: "my-test",
      variations: [0, 1],
    };

    const expected = [1, 0, 0, 1, 1, 1, 0, 1, 0];
    expected.forEach((v, i) => {
      growthbook.context.user = { id: i + 1 + "" };
      expect(growthbook.run(exp).value).toEqual(v);
    });

    growthbook.destroy();
  });
  it("unevenWeights", () => {
    const growthbook = new GrowthBook({});

    const exp: Experiment<number> = {
      key: "my-test",
      variations: [0, 1],
      weights: [0.1, 0.9],
    };

    const expected = [1, 1, 0, 1, 1, 1, 0, 1, 1];
    expected.forEach((v, i) => {
      growthbook.context.user = { id: i + 1 + "" };
      expect(growthbook.run(exp).value).toEqual(v);
    });

    growthbook.destroy();
  });
  it("bucket ranges", () => {
    // Normal 50/50 split
    expect(getBucketRanges(2, 1)).toEqual([
      [0, 0.5],
      [0.5, 1],
    ]);

    // Reduced coverage
    expect(getBucketRanges(2, 0.5)).toEqual([
      [0, 0.25],
      [0.5, 0.75],
    ]);

    // Zero coverage
    expect(getBucketRanges(2, 0)).toEqual([
      [0, 0],
      [0.5, 0.5],
    ]);

    // More variations
    expect(getBucketRanges(4, 1)).toEqual([
      [0, 0.25],
      [0.25, 0.5],
      [0.5, 0.75],
      [0.75, 1],
    ]);

    // Uneven weights
    expect(getBucketRanges(2, 1, [0.4, 0.6])).toEqual([
      [0, 0.4],
      [0.4, 1],
    ]);

    // Uneven weights, more variations
    expect(getBucketRanges(3, 1, [0.2, 0.3, 0.5])).toEqual([
      [0, 0.2],
      [0.2, 0.5],
      [0.5, 1],
    ]);

    // Uneven weights, more variations, reduced coverage
    expect(getBucketRanges(3, 0.2, [0.2, 0.3, 0.5])).toEqual([
      [0, 0.2 * 0.2],
      [0.2, 0.2 + 0.3 * 0.2],
      [0.5, 0.5 + 0.5 * 0.2],
    ]);
  });
  it("choose variation", () => {
    const evenRange: [number, number][] = [
      [0, 0.5],
      [0.5, 1],
    ];
    const reducedRange: [number, number][] = [
      [0, 0.25],
      [0.5, 0.75],
    ];
    const zeroRange: [number, number][] = [
      [0, 0.5],
      [0.5, 0.5],
      [0.5, 1],
    ];

    expect(chooseVariation(0.2, evenRange)).toEqual(0);
    expect(chooseVariation(0.6, evenRange)).toEqual(1);
    expect(chooseVariation(0.4, evenRange)).toEqual(0);
    expect(chooseVariation(0.8, evenRange)).toEqual(1);
    expect(chooseVariation(0, evenRange)).toEqual(0);
    expect(chooseVariation(0.5, evenRange)).toEqual(1);

    expect(chooseVariation(0.2, reducedRange)).toEqual(0);
    expect(chooseVariation(0.6, reducedRange)).toEqual(1);
    expect(chooseVariation(0.4, reducedRange)).toEqual(-1);
    expect(chooseVariation(0.8, reducedRange)).toEqual(-1);

    expect(chooseVariation(0.5, zeroRange)).toEqual(2);
  });

  it("hashing", () => {
    expect(hashFnv32a("a") % 1000).toEqual(220);
    expect(hashFnv32a("b") % 1000).toEqual(77);
    expect(hashFnv32a("ab") % 1000).toEqual(946);
    expect(hashFnv32a("def") % 1000).toEqual(652);
    expect(hashFnv32a("8952klfjas09ujkasdf") % 1000).toEqual(549);
    expect(hashFnv32a("123") % 1000).toEqual(11);
    expect(hashFnv32a('___)((*":&') % 1000).toEqual(563);
  });

  it("coverage", () => {
    const growthbook = new GrowthBook({});

    const exp: Experiment<number> = {
      key: "my-test",
      variations: [0, 1],
      coverage: 0.4,
    };

    const expected = [-1, 0, 0, -1, 1, -1, 0, 1, -1];
    expected.forEach((v, i) => {
      growthbook.context.user = { id: i + 1 + "" };
      const res = growthbook.run(exp);
      const actual = res.inExperiment ? res.value : -1;
      expect(actual).toEqual(v);
    });

    growthbook.destroy();
  });
  it("threeWayTest", () => {
    const growthbook = new GrowthBook({});

    const exp: Experiment<number> = {
      key: "my-test",
      variations: [0, 1, 2],
    };

    const expected = [2, 0, 0, 2, 1, 2, 0, 1, 0];
    expected.forEach((v, i) => {
      growthbook.context.user = { id: i + 1 + "" };
      expect(growthbook.run(exp).value).toEqual(v);
    });

    growthbook.destroy();
  });
  it("testName", () => {
    const growthbook = new GrowthBook({ user: { id: "1" } });

    expect(
      growthbook.run({ key: "my-test", variations: [0, 1] }).value
    ).toEqual(1);
    expect(
      growthbook.run({ key: "my-test-3", variations: [0, 1] }).value
    ).toEqual(0);

    growthbook.destroy();
  });
  it("missing id", () => {
    const growthbook = new GrowthBook({ user: { id: "1" } });

    const exp: Experiment<number> = {
      key: "my-test",
      variations: [0, 1],
    };
    expect(growthbook.run(exp).inExperiment).toEqual(true);
    growthbook.context.user = { id: "" };
    expect(growthbook.run(exp).inExperiment).toEqual(false);

    growthbook.destroy();
  });
  it("tracking", () => {
    const growthbook = new GrowthBook({ user: { id: "1" } });
    const mock = mockCallback(growthbook);

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
    growthbook.context.user = { id: "2" };
    const res5 = growthbook.run(exp2);

    expect(mock.calls.length).toEqual(3);
    expect(mock.calls[0]).toEqual([exp1, res1]);
    expect(mock.calls[1]).toEqual([exp2, res4]);
    expect(mock.calls[2]).toEqual([exp2, res5]);

    growthbook.destroy();
  });

  it("persists assignment when coverage changes", () => {
    expect(getBucketRanges(2, 0.1, [0.4, 0.6])).toEqual([
      [0, 0.4 * 0.1],
      [0.4, 0.4 + 0.6 * 0.1],
    ]);

    expect(getBucketRanges(2, 1, [0.4, 0.6])).toEqual([
      [0, 0.4],
      [0.4, 1],
    ]);
  });

  it("handles weird experiment values", () => {
    const growthbook = new GrowthBook({ user: { id: "1" } });
    const spy = jest.spyOn(console, "error").mockImplementation();

    expect(
      growthbook.run({
        key: "my-test",
        // eslint-disable-next-line
        // @ts-ignore
        variations: [0],
      }).inExperiment
    ).toEqual(false);

    expect(
      growthbook.run({
        key: "my-test",
        variations: [0, 1],
        include: () => {
          throw new Error("Blah");
        },
      }).inExperiment
    ).toEqual(false);

    expect(getBucketRanges(2, -0.2)).toEqual([
      [0, 0],
      [0.5, 0.5],
    ]);

    expect(getBucketRanges(2, 1.5)).toEqual([
      [0, 0.5],
      [0.5, 1],
    ]);

    expect(getBucketRanges(2, 1, [0.4, 0.1])).toEqual([
      [0, 0.5],
      [0.5, 1],
    ]);

    expect(getBucketRanges(2, 1, [0.7, 0.6])).toEqual([
      [0, 0.5],
      [0.5, 1],
    ]);

    expect(getBucketRanges(4, 1, [0.4, 0.4, 0.2])).toEqual([
      [0, 0.25],
      [0.25, 0.5],
      [0.5, 0.75],
      [0.75, 1],
    ]);

    const res1 = growthbook.run({
      key: "my-test",
      variations: [0, 1],
      force: -8,
    });
    expect(res1.inExperiment).toEqual(false);
    expect(res1.value).toEqual(0);

    const res2 = growthbook.run({
      key: "my-test",
      variations: [0, 1],
      force: 25,
    });
    expect(res2.inExperiment).toEqual(false);
    expect(res2.value).toEqual(0);

    // Should fail gracefully
    growthbook.context.trackingCallback = () => {
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

    const growthbook = new GrowthBook({ user: { id: "1" } });
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
    // 1. Trying to put user in experiment
    // 2. User put in experiment
    expect(spy.mock.calls.length).toEqual(2);

    growthbook.debug = false;
    spy.mockRestore();
    growthbook.destroy();
  });

  it("uses window.location.href by default", () => {
    window.location.href = "http://example.com/path";
    const growthbook = new GrowthBook({ user: { id: "1" } });
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

  it("force variation", () => {
    const growthbook = new GrowthBook({ user: { id: "6" } });
    const exp: Experiment<number> = { key: "forced-test", variations: [0, 1] };
    expect(growthbook.run(exp).value).toEqual(0);

    const mock = mockCallback(growthbook);
    growthbook.context.overrides = {
      "forced-test": {
        force: 1,
      },
    };
    expect(growthbook.run(exp).value).toEqual(1);
    expect(mock.calls.length).toEqual(0);

    growthbook.destroy();
  });

  it("uses overrides", () => {
    const growthbook = new GrowthBook({
      user: { id: "1" },
      overrides: {
        "my-test": {
          coverage: 0.01,
        },
      },
    });

    expect(
      growthbook.run({
        key: "my-test",
        variations: [0, 1],
      }).inExperiment
    ).toEqual(false);

    growthbook.context.overrides = {
      "my-test": {
        url: /^\/path/,
      },
    };

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

  it("runs custom include callback", () => {
    const growthbook = new GrowthBook({ user: { id: "1" } });
    expect(
      growthbook.run({
        key: "my-test",
        variations: [0, 1],
        include: () => false,
      }).inExperiment
    ).toEqual(false);

    growthbook.destroy();
  });

  it("supports custom user hash keys", () => {
    const growthbook = new GrowthBook({});
    for (let i = 0; i < 10; i++) {
      growthbook.context = {
        user: {
          id: i + "",
          companyId: "1",
        },
      };
      const { inExperiment, variationId } = growthbook.run({
        key: "my-test",
        variations: [0, 1],
        hashAttribute: "companyId",
      });
      expect({
        inExperiment,
        variationId,
      }).toEqual({
        inExperiment: true,
        variationId: 1,
      });
    }

    growthbook.destroy();
  });

  it("experiments disabled", () => {
    const growthbook = new GrowthBook({ user: { id: "1" }, enabled: false });
    const mock = mockCallback(growthbook);

    // Experiment
    expect(
      growthbook.run({ key: "disabled-test", variations: [0, 1] }).inExperiment
    ).toEqual(false);

    expect(mock.calls.length).toEqual(0);

    growthbook.destroy();
  });

  it("querystring force", () => {
    const growthbook = new GrowthBook({ user: { id: "1" } });
    const exp: Experiment<number> = {
      key: "forced-test-qs",
      variations: [0, 1],
    };
    const res1 = growthbook.run(exp);
    expect(res1.value).toEqual(0);
    expect(res1.inExperiment).toEqual(true);

    growthbook.context.url = "http://example.com?forced-test-qs=1#someanchor";

    const res2 = growthbook.run(exp);
    expect(res2.value).toEqual(1);
    expect(res2.inExperiment).toEqual(false);

    growthbook.destroy();
  });

  it("querystring force disabled tracking", () => {
    const growthbook = new GrowthBook({
      user: { id: "1" },
      url: "http://example.com?forced-test-qs=1",
    });
    const mock = mockCallback(growthbook);
    const exp: Experiment<number> = {
      key: "forced-test-qs",
      variations: [0, 1],
    };
    growthbook.run(exp);
    expect(mock.calls.length).toEqual(0);

    growthbook.destroy();
  });

  it("querystring force invalid url", () => {
    expect(getQueryStringOverride("my-test", "")).toEqual(null);

    expect(getQueryStringOverride("my-test", "http://example.com")).toEqual(
      null
    );

    expect(getQueryStringOverride("my-test", "http://example.com?")).toEqual(
      null
    );

    expect(
      getQueryStringOverride("my-test", "http://example.com?somequery")
    ).toEqual(null);

    expect(
      getQueryStringOverride("my-test", "http://example.com??&&&?#")
    ).toEqual(null);
  });

  it("url targeting", () => {
    const growthbook = new GrowthBook({
      user: { id: "1" },
      url: "http://example.com",
    });
    const exp: Experiment<number> = {
      key: "my-test",
      variations: [0, 1],
      url: /^\/post\/[0-9]+/,
    };

    expect(growthbook.run(exp)).toMatchObject({
      inExperiment: false,
      value: 0,
    });

    growthbook.context.url = "http://example.com/post/123";
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
    const growthbook = new GrowthBook({ user: { id: "1" } });
    const exp: Experiment<number> = {
      key: "my-test",
      status: "draft",
      variations: [0, 1],
    };

    const res1 = growthbook.run(exp);
    growthbook.context.url = "http://example.com/?my-test=1";
    const res2 = growthbook.run(exp);

    expect(res1.inExperiment).toEqual(false);
    expect(res1.value).toEqual(0);
    expect(res2.inExperiment).toEqual(false);
    expect(res2.value).toEqual(1);

    growthbook.destroy();
  });

  it("ignores stopped experiments unless forced", () => {
    const growthbook = new GrowthBook({ user: { id: "1" } });
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
    expect(res2.value).toEqual(2);
    expect(res2.inExperiment).toEqual(false);

    growthbook.destroy();
  });

  it("destroy removes subscriptions", () => {
    const growthbook = new GrowthBook({ user: { id: "1" } });
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

  it("configData experiment", () => {
    const growthbook = new GrowthBook({ user: { id: "1" } });
    const exp: Experiment<{ color: string; size: string }> = {
      key: "my-test",
      variations: [
        {
          color: "blue",
          size: "small",
        },
        {
          color: "green",
          size: "large",
        },
      ],
    };

    const res1 = growthbook.run(exp);
    expect(res1.variationId).toEqual(1);
    expect(res1.value).toEqual({
      color: "green",
      size: "large",
    });

    // Fallback to control config data if not in test
    exp.coverage = 0.01;
    const res2 = growthbook.run(exp);
    expect(res2.inExperiment).toEqual(false);
    expect(res2.variationId).toEqual(0);
    expect(res2.value).toEqual({
      color: "blue",
      size: "small",
    });

    growthbook.destroy();
  });

  it("does even weighting", () => {
    const growthbook = new GrowthBook({});
    // Full coverage
    const exp: Experiment<number> = { key: "my-test", variations: [0, 1] };
    let variations: Record<string, number> = {
      "0": 0,
      "1": 0,
      "-1": 0,
    };
    for (let i = 0; i < 1000; i++) {
      growthbook.context.user = { id: i + "" };
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
      growthbook.context.user = { id: i + "" };
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
      growthbook.context.user = { id: i + "" };
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

  it("forces variations from the client", () => {
    const growthbook = new GrowthBook({ user: { id: "1" } });
    const exp: Experiment<number> = {
      key: "my-test",
      variations: [0, 1],
    };
    const res1 = growthbook.run(exp);
    expect(res1.inExperiment).toEqual(true);
    expect(res1.value).toEqual(1);

    growthbook.context.forcedVariations = { "my-test": 0 };
    const res2 = growthbook.run(exp);
    expect(res2.inExperiment).toEqual(false);
    expect(res2.value).toEqual(0);

    growthbook.destroy();
  });

  it("forces all variations to -1 in qa mode", () => {
    const growthbook = new GrowthBook({ user: { id: "1" }, qaMode: true });
    const exp: Experiment<number> = {
      key: "my-test",
      variations: [0, 1],
    };

    const res1 = growthbook.run(exp);
    expect(res1.inExperiment).toEqual(false);
    expect(res1.value).toEqual(0);

    // Still works if explicitly forced
    growthbook.context.forcedVariations = { "my-test": 1 };
    const res2 = growthbook.run(exp);
    expect(res2.inExperiment).toEqual(false);
    expect(res2.value).toEqual(1);

    // Works if the experiment itself is forced
    const res3 = growthbook.run({
      key: "my-test-2",
      variations: [0, 1],
      force: 1,
    });
    expect(res3.inExperiment).toEqual(false);
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
    const growthbook = new GrowthBook({
      user: { id: "1" },
    });
    let called = false;
    growthbook.setRenderer(() => {
      called = true;
    });

    expect(called).toEqual(false);
    growthbook.forceVariation("my-test", 1);
    expect(growthbook.context.forcedVariations).toEqual({ "my-test": 1 });
    expect(called).toEqual(true);

    growthbook.destroy();
  });

  it("stores growthbook instance in window", () => {
    const growthbook = new GrowthBook({});

    expect(window._growthbook).toEqual(growthbook);

    growthbook.destroy();

    expect(window._growthbook).toBeUndefined();
  });
});
