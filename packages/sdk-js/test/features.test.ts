import { Context, GrowthBook } from "../src";

/* eslint-disable */
const { webcrypto } = require("node:crypto");
import { TextEncoder, TextDecoder } from "util";
global.TextEncoder = TextEncoder;
(global as any).TextDecoder = TextDecoder;
/* eslint-enable */

const mockCallback = (context: Context) => {
  const onFeatureUsage = jest.fn((a) => {
    return a;
  });
  context.onFeatureUsage = onFeatureUsage;
  return onFeatureUsage.mock;
};

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

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

  it("decrypts features with custom SubtleCrypto implementation", async () => {
    const growthbook = new GrowthBook();

    const keyString = "Ns04T5n9+59rl2x3SlNHtQ==";
    const encrypedFeatures =
      "vMSg2Bj/IurObDsWVmvkUg==.L6qtQkIzKDoE2Dix6IAKDcVel8PHUnzJ7JjmLjFZFQDqidRIoCxKmvxvUj2kTuHFTQ3/NJ3D6XhxhXXv2+dsXpw5woQf0eAgqrcxHrbtFORs18tRXRZza7zqgzwvcznx";

    // Make sure it's not using the built-in crypto implementation
    const originalCrypto = globalThis.crypto;
    // eslint-disable-next-line
    (globalThis.crypto as any) = undefined;

    await growthbook.setEncryptedFeatures(
      encrypedFeatures,
      keyString,
      webcrypto.subtle
    );

    expect(growthbook.getFeatures()).toEqual({
      testfeature1: {
        defaultValue: true,
        rules: [
          {
            condition: { id: "1234" },
            force: false,
          },
        ],
      },
    });

    growthbook.destroy();
    globalThis.crypto = originalCrypto;
  });

  it("decrypts features using the native SubtleCrypto implementation", async () => {
    const growthbook = new GrowthBook();

    const originalCrypto = globalThis.crypto;
    globalThis.crypto = webcrypto;

    const keyString = "Ns04T5n9+59rl2x3SlNHtQ==";
    const encrypedFeatures =
      "vMSg2Bj/IurObDsWVmvkUg==.L6qtQkIzKDoE2Dix6IAKDcVel8PHUnzJ7JjmLjFZFQDqidRIoCxKmvxvUj2kTuHFTQ3/NJ3D6XhxhXXv2+dsXpw5woQf0eAgqrcxHrbtFORs18tRXRZza7zqgzwvcznx";

    await growthbook.setEncryptedFeatures(encrypedFeatures, keyString);

    expect(growthbook.getFeatures()).toEqual({
      testfeature1: {
        defaultValue: true,
        rules: [
          {
            condition: { id: "1234" },
            force: false,
          },
        ],
      },
    });
    growthbook.destroy();

    // Reset
    globalThis.crypto = originalCrypto;
  });

  it("throws when decrypting features with invalid key", async () => {
    const growthbook = new GrowthBook();

    const keyString = "fakeT5n9+59rl2x3SlNHtQ==";
    const encrypedFeatures =
      "vMSg2Bj/IurObDsWVmvkUg==.L6qtQkIzKDoE2Dix6IAKDcVel8PHUnzJ7JjmLjFZFQDqidRIoCxKmvxvUj2kTuHFTQ3/NJ3D6XhxhXXv2+dsXpw5woQf0eAgqrcxHrbtFORs18tRXRZza7zqgzwvcznx";

    await expect(
      growthbook.setEncryptedFeatures(
        encrypedFeatures,
        keyString,
        webcrypto.subtle
      )
    ).rejects.toThrow("Failed to decrypt features");

    growthbook.destroy();
  });

  it("throws when decrypting features with invalid encrypted value", async () => {
    const growthbook = new GrowthBook();

    const keyString = "Ns04T5n9+59rl2x3SlNHtQ==";
    const encrypedFeatures =
      "FAKE2Bj/IurObDsWVmvkUg==.L6qtQkIzKDoE2Dix6IAKDcVel8PHUnzJ7JjmLjFZFQDqidRIoCxKmvxvUj2kTuHFTQ3/NJ3D6XhxhXXv2+dsXpw5woQf0eAgqrcxHrbtFORs18tRXRZza7zqgzwvcznx";

    await expect(
      growthbook.setEncryptedFeatures(
        encrypedFeatures,
        keyString,
        webcrypto.subtle
      )
    ).rejects.toThrow("Failed to decrypt features");

    growthbook.destroy();
  });

  it("throws when decrypting features and no SubtleCrypto implementation exists", async () => {
    const growthbook = new GrowthBook();

    const keyString = "Ns04T5n9+59rl2x3SlNHtQ==";
    const encrypedFeatures =
      "vMSg2Bj/IurObDsWVmvkUg==.L6qtQkIzKDoE2Dix6IAKDcVel8PHUnzJ7JjmLjFZFQDqidRIoCxKmvxvUj2kTuHFTQ3/NJ3D6XhxhXXv2+dsXpw5woQf0eAgqrcxHrbtFORs18tRXRZza7zqgzwvcznx";

    const originalCrypto = globalThis.crypto;
    // eslint-disable-next-line
    (globalThis.crypto as any) = undefined;

    await expect(
      growthbook.setEncryptedFeatures(encrypedFeatures, keyString)
    ).rejects.toThrow("No SubtleCrypto implementation found");

    growthbook.destroy();
    globalThis.crypto = originalCrypto;
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

  it("re-fires feature usage when assigned value changes", () => {
    const context: Context = {
      attributes: { color: "green" },
      features: {
        feature: {
          defaultValue: 0,
          rules: [
            {
              condition: {
                color: "blue",
              },
              force: 1,
            },
          ],
        },
      },
    };
    const growthbook = new GrowthBook(context);
    const mock = mockCallback(context);

    // Fires for regular features
    const res1 = growthbook.evalFeature("feature");
    expect(res1.value).toEqual(0);
    growthbook.setAttributes({
      color: "blue",
    });
    // Fires when the assigned value changes
    const res2 = growthbook.evalFeature("feature");
    expect(res2.value).toEqual(1);

    expect(mock.calls.length).toEqual(2);
    expect(mock.calls[0]).toEqual(["feature", res1]);
    expect(mock.calls[1]).toEqual(["feature", res2]);

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

    await sleep(100);

    const events = [
      {
        key: "feature1",
        on: true,
      },
      {
        key: "feature2",
        on: false,
      },
      {
        key: "feature3",
        on: true,
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

  it("uses fallbacks get getFeatureValue", () => {
    const growthbook = new GrowthBook({
      features: {
        feature: {
          defaultValue: "blue",
        },
      },
    });

    expect(growthbook.getFeatureValue("feature", "green")).toEqual("blue");
    expect(growthbook.getFeatureValue("unknown", "green")).toEqual("green");
    expect(growthbook.getFeatureValue("testing", null)).toEqual(null);

    growthbook.destroy();
  });

  it("clears realtime timer on destroy", async () => {
    const f = window.fetch;
    const mock = jest.fn((url, options) => {
      return Promise.resolve([url, options]);
    });
    // eslint-disable-next-line
    (window.fetch as any) = mock;

    const growthbook = new GrowthBook({
      realtimeKey: "abc",
      realtimeInterval: 50,
      features: {
        feature1: {
          defaultValue: "1",
        },
      },
    });

    expect(growthbook.isOn("feature1")).toEqual(true);
    growthbook.destroy();

    await sleep(100);

    expect(mock.mock.calls.length).toEqual(0);
    window.fetch = f;
  });
});
