import { GrowthBook } from "../src";

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
      value: false,
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
      value: true,
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
          values: ["a", "b", "c"],
          defaultValue: 2,
        },
      },
    });
    const res = growthbook.feature("feature");
    expect(res).toEqual({
      value: "c",
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
          values: ["a", "b", "c"],
          defaultValue: 2,
          rules: [
            {
              type: "force",
              value: 1,
            },
          ],
        },
      },
    });
    const res = growthbook.feature("feature");
    expect(res).toEqual({
      value: "b",
      on: true,
      off: false,
      source: "force",
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
          values: ["a", "b", "c"],
          defaultValue: 2,
          rules: [
            {
              type: "force",
              value: 1,
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
      value: "b",
      on: true,
      off: false,
      source: "force",
    });
    attributes.browser = "chrome";
    const res2 = growthbook.feature("feature");
    expect(res2).toEqual({
      value: "c",
      on: true,
      off: false,
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
          values: ["a", "b", "c"],
          rules: [
            {
              type: "experiment",
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
        trackingKey: "feature",
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
        trackingKey: "feature",
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
        trackingKey: "feature",
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
              type: "experiment",
              coverage: 0.99,
              hashAttribute: "anonId",
              namespace: ["pricing", 0, 1],
              trackingKey: "hello",
              variations: [1, 0],
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
      trackingKey: "hello",
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
          values: [0, 1, 2, 3],
          rules: [
            {
              type: "force",
              value: 1,
              condition: { browser: "chrome" },
            },
            {
              type: "force",
              value: 2,
              condition: { browser: "firefox" },
            },
            {
              type: "force",
              value: 3,
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
});
