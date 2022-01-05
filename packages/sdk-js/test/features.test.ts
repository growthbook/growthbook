import { Context, GrowthBook } from "../src";

describe("features", () => {
  it("works for unknown features", () => {
    const growthbook = new GrowthBook({});

    const res = growthbook.feature("my-feature");
    expect(res).toEqual({
      value: null,
      on: false,
      off: true,
      source: "unknownFeature",
    });
    growthbook.destroy();
  });
  it("has defaults when empty", () => {
    const growthbook = new GrowthBook({
      features: {
        feature: {},
      },
    });
    const res = growthbook.feature("feature");
    expect(res).toEqual({
      value: null,
      on: false,
      off: true,
      source: "defaultValue",
    });
    growthbook.destroy();
  });
  it("uses defaultValue", () => {
    const growthbook = new GrowthBook({
      features: {
        feature: {
          defaultValue: 1,
        },
      },
    });
    const res = growthbook.feature("feature");
    expect(res).toEqual({
      value: 1,
      on: true,
      off: false,
      source: "defaultValue",
    });
    growthbook.destroy();
  });
  it("uses custom values", () => {
    const growthbook = new GrowthBook({
      features: {
        feature: {
          defaultValue: "yes",
        },
      },
    });
    const res = growthbook.feature("feature");
    expect(res).toEqual({
      value: "yes",
      on: true,
      off: false,
      source: "defaultValue",
    });
    growthbook.destroy();
  });
  it("supports force rules", () => {
    const growthbook = new GrowthBook({
      features: {
        feature: {
          defaultValue: 2,
          rules: [
            {
              force: 1,
            },
          ],
        },
      },
    });
    const res = growthbook.feature("feature");
    expect(res).toEqual({
      value: 1,
      on: true,
      off: false,
      source: "force",
    });
    growthbook.destroy();
  });
  it("supports coverage on force rules", () => {
    const attributes: { id?: string } = {
      id: "3",
    };
    const growthbook = new GrowthBook({
      attributes,
      features: {
        feature: {
          defaultValue: 2,
          rules: [
            {
              force: 1,
              coverage: 0.5,
            },
          ],
        },
      },
    });
    expect(growthbook.feature("feature")).toEqual({
      value: 1,
      on: true,
      off: false,
      source: "force",
    });

    attributes.id = "1";
    expect(growthbook.feature("feature")).toEqual({
      value: 2,
      on: true,
      off: false,
      source: "defaultValue",
    });

    delete attributes.id;
    expect(growthbook.feature("feature")).toEqual({
      value: 2,
      on: true,
      off: false,
      source: "defaultValue",
    });

    growthbook.destroy();
  });
  it("supports conditions on force rules", () => {
    const attributes = {
      country: "US",
      browser: "firefox",
    };
    const growthbook = new GrowthBook({
      attributes,
      features: {
        feature: {
          defaultValue: 2,
          rules: [
            {
              force: 1,
              condition: {
                country: { $in: ["US", "CA"] },
                browser: "firefox",
              },
            },
          ],
        },
      },
    });
    const res = growthbook.feature("feature");
    expect(res).toEqual({
      value: 1,
      on: true,
      off: false,
      source: "force",
    });
    attributes.browser = "chrome";
    const res2 = growthbook.feature("feature");
    expect(res2).toEqual({
      value: 2,
      on: true,
      off: false,
      source: "defaultValue",
    });
    growthbook.destroy();
  });

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

  it("ignores empty rules", () => {
    const growthbook = new GrowthBook({
      features: {
        feature: {
          rules: [{}],
        },
      },
    });

    expect(growthbook.feature("feature")).toEqual({
      value: null,
      on: false,
      off: true,
      source: "defaultValue",
    });

    growthbook.destroy();
  });

  it("supports empty experiment rules", () => {
    const attributes = {
      id: "123",
    };
    const growthbook = new GrowthBook({
      attributes,
      features: {
        feature: {
          rules: [
            {
              variations: ["a", "b", "c"],
            },
          ],
        },
      },
    });

    expect(growthbook.feature("feature")).toEqual({
      value: "c",
      on: true,
      off: false,
      experiment: {
        key: "feature",
        variations: ["a", "b", "c"],
      },
      source: "experiment",
    });
    attributes.id = "456";
    expect(growthbook.feature("feature")).toEqual({
      value: "a",
      on: true,
      off: false,
      experiment: {
        key: "feature",
        variations: ["a", "b", "c"],
      },
      source: "experiment",
    });
    attributes.id = "fds";
    expect(growthbook.feature("feature")).toEqual({
      value: "b",
      on: true,
      off: false,
      experiment: {
        key: "feature",
        variations: ["a", "b", "c"],
      },
      source: "experiment",
    });

    growthbook.destroy();
  });

  it("creates experiments properly", () => {
    const growthbook = new GrowthBook({
      attributes: {
        anonId: "123",
        premium: true,
      },
      features: {
        feature: {
          rules: [
            {
              coverage: 0.99,
              hashAttribute: "anonId",
              namespace: ["pricing", 0, 1],
              key: "hello",
              variations: [true, false],
              weights: [0.1, 0.9],
              condition: { premium: true },
            },
          ],
        },
      },
    });

    expect(growthbook.feature("feature").experiment).toEqual({
      coverage: 0.99,
      hashAttribute: "anonId",
      namespace: ["pricing", 0, 1],
      key: "hello",
      variations: [true, false],
      weights: [0.1, 0.9],
    });

    growthbook.destroy();
  });

  it("finds first matching rule", () => {
    const attributes = {
      browser: "firefox",
    };
    const growthbook = new GrowthBook({
      attributes,
      features: {
        feature: {
          defaultValue: 0,
          rules: [
            {
              force: 1,
              condition: { browser: "chrome" },
            },
            {
              force: 2,
              condition: { browser: "firefox" },
            },
            {
              force: 3,
              condition: { browser: "safari" },
            },
          ],
        },
      },
    });

    expect(growthbook.feature("feature").value).toEqual(2);
    attributes.browser = "safari";
    expect(growthbook.feature("feature").value).toEqual(3);
    attributes.browser = "ie";
    expect(growthbook.feature("feature").value).toEqual(0);

    growthbook.destroy();
  });

  it("falls through to next rule when experiment coverage excludes the user", () => {
    const growthbook = new GrowthBook({
      attributes: { id: "123" },
      features: {
        feature: {
          defaultValue: 0,
          rules: [
            {
              variations: [0, 1, 2, 3],
              coverage: 0.01,
            },
            {
              force: 3,
            },
          ],
        },
      },
    });

    expect(growthbook.feature("feature")).toEqual({
      value: 3,
      on: true,
      off: false,
      source: "force",
    });

    growthbook.destroy();
  });

  it("falls through to next rule when experiment namespace excludes the user", () => {
    const growthbook = new GrowthBook({
      attributes: { id: "123" },
      features: {
        feature: {
          defaultValue: 0,
          rules: [
            {
              variations: [0, 1, 2, 3],
              namespace: ["pricing", 0, 0.01],
            },
            {
              force: 3,
            },
          ],
        },
      },
    });

    expect(growthbook.feature("feature")).toEqual({
      value: 3,
      on: true,
      off: false,
      source: "force",
    });

    growthbook.destroy();
  });

  it("falls through to next rule when experiment hashAttribute excludes the user", () => {
    const growthbook = new GrowthBook({
      attributes: { id: "123" },
      features: {
        feature: {
          defaultValue: 0,
          rules: [
            {
              variations: [0, 1, 2, 3],
              hashAttribute: "company",
            },
            {
              force: 3,
            },
          ],
        },
      },
    });

    expect(growthbook.feature("feature")).toEqual({
      value: 3,
      on: true,
      off: false,
      source: "force",
    });

    growthbook.destroy();
  });

  it("can set features asynchronously", () => {
    const growthbook = new GrowthBook({
      attributes: {
        id: "123",
      },
    });
    expect(growthbook.feature("feature")).toEqual({
      value: null,
      on: false,
      off: true,
      source: "unknownFeature",
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
      source: "defaultValue",
    });

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
});
