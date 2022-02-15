import { Context, GrowthBook } from "../src";

const mockCallback = (context: Context) => {
  const onFeatureUsage = jest.fn((a) => {
    return a;
  });
  context.onFeatureUsage = onFeatureUsage;
  return onFeatureUsage.mock;
};

describe("features", () => {
  it("renders when features are set", () => {
    const context: Context = {
      user: { id: "1" },
    };
    const growthbook = new GrowthBook(context);
    let called = false;
    growthbook.setRenderer(() => {
      called = true;
    });

    expect(called).toEqual(false);
    growthbook.setFeatures({ id: {} });
    expect(called).toEqual(true);

    growthbook.destroy();
  });

  it("can set features asynchronously", () => {
    const growthbook = new GrowthBook({
      attributes: {
        id: "123",
      },
    });
    growthbook.setFeatures({
      feature: {
        defaultValue: 0,
      },
    });
    expect(growthbook.feature("feature")).toEqual({
      value: 0,
      on: false,
      off: true,
      ruleId: "",
      source: "defaultValue",
    });
    growthbook.destroy();
  });

  it("returns ruleId when evaluating a feature", () => {
    const growthbook = new GrowthBook({
      features: {
        feature: {
          defaultValue: 0,
          rules: [
            {
              force: 1,
              id: "foo",
            },
          ],
        },
      },
    });
    expect(growthbook.evalFeature("feature").ruleId).toEqual("foo");
    growthbook.destroy();
  });

  it("updates attributes with setAttributes", () => {
    const context: Context = {
      attributes: {
        foo: 1,
        bar: 2,
      },
    };

    const growthbook = new GrowthBook(context);

    growthbook.setAttributes({ foo: 2, baz: 3 });

    expect(context.attributes).toEqual({
      foo: 2,
      baz: 3,
    });
  });

  it("uses attribute overrides", () => {
    const growthbook = new GrowthBook({
      attributes: {
        id: "123",
        foo: "bar",
      },
    });

    growthbook.setAttributeOverrides({
      foo: "baz",
    });

    expect(growthbook.getAttributes()).toEqual({
      id: "123",
      foo: "baz",
    });
    expect(
      growthbook.run({
        key: "my-test",
        variations: [0, 1],
        hashAttribute: "foo",
      }).hashValue
    ).toEqual("baz");

    growthbook.setAttributeOverrides({});
    expect(growthbook.getAttributes()).toEqual({
      id: "123",
      foo: "bar",
    });
    expect(
      growthbook.run({
        key: "my-test",
        variations: [0, 1],
        hashAttribute: "foo",
      }).hashValue
    ).toEqual("bar");

    growthbook.destroy();
  });

  it("uses forced feature values", () => {
    const growthbook = new GrowthBook({
      features: {
        feature1: {
          defaultValue: 0,
        },
        feature2: {
          defaultValue: 0,
        },
      },
    });

    growthbook.setForcedFeatures(
      new Map(
        Object.entries({
          feature2: 1,
          feature3: 1,
        })
      )
    );

    expect(growthbook.feature("feature1").value).toEqual(0);
    expect(growthbook.feature("feature2").value).toEqual(1);
    expect(growthbook.feature("feature3").value).toEqual(1);

    growthbook.setForcedFeatures(new Map());
    expect(growthbook.feature("feature1").value).toEqual(0);
    expect(growthbook.feature("feature2").value).toEqual(0);
    expect(growthbook.feature("feature3").value).toEqual(null);

    growthbook.destroy();
  });

  it("gets features", () => {
    const features = {
      feature1: { defaultValue: 0 },
    };
    const growthbook = new GrowthBook({
      features,
    });

    expect(growthbook.getFeatures()).toEqual(features);

    growthbook.destroy();
  });

  it("fires feature usage callback", () => {
    const context: Context = {
      attributes: { id: "1" },
      features: {
        feature1: {
          defaultValue: 0,
        },
        feature3: {
          defaultValue: 1,
        },
      },
    };
    const growthbook = new GrowthBook(context);
    const forcedFeatures = new Map();
    forcedFeatures.set("feature3", 5);
    growthbook.setForcedFeatures(forcedFeatures);
    const mock = mockCallback(context);

    // Fires for regular features
    const res1 = growthbook.evalFeature("feature1");
    // Fires for unknown features
    const res2 = growthbook.evalFeature("feature2");
    // Does not fire for repeats
    growthbook.evalFeature("feature1");
    // Does not fire when value is forced via an override
    growthbook.evalFeature("feature3");

    expect(mock.calls.length).toEqual(2);
    expect(mock.calls[0]).toEqual(["feature1", res1]);
    expect(mock.calls[1]).toEqual(["feature2", res2]);

    growthbook.destroy();
  });

  it("fires real-time usage call", async () => {
    const f = window.fetch;
    const mock = jest.fn((url, options) => {
      return Promise.resolve([url, options]);
    });
    // eslint-disable-next-line
    (window.fetch as any) = mock;

    const growthbook = new GrowthBook({
      realtimeKey: "abc",
      realtimeInterval: 50,
      attributes: { id: "1" },
      features: {
        feature1: {
          defaultValue: "1",
          rules: [
            {
              id: "f",
              force: "2",
            },
          ],
        },
        feature3: {
          rules: [
            {
              variations: ["a", "b"],
            },
          ],
        },
      },
    });

    expect(growthbook.isOn("feature1")).toEqual(true);
    expect(growthbook.isOff("feature2")).toEqual(true);
    expect(growthbook.getFeatureValue("feature3", "default")).toEqual("a");

    await new Promise<void>((resolve) => {
      window.setTimeout(() => {
        resolve();
      }, 100);
    });

    const events = [
      {
        key: "feature1",
        res: "force",
        rule: "f",
      },
      {
        key: "feature2",
        res: "unknownFeature",
        rule: "",
      },
      {
        key: "feature3",
        res: "experiment",
        rule: "",
        var: 0,
      },
    ];
    const expectedUrl = `https://rt.growthbook.io/?key=abc&events=${encodeURIComponent(
      JSON.stringify(events)
    )}`;

    expect(mock.mock.calls.length).toEqual(1);
    expect(mock.mock.calls[0]).toEqual([
      expectedUrl,
      {
        mode: "no-cors",
        cache: "no-cache",
      },
    ]);

    growthbook.destroy();
    window.fetch = f;
  });
});
