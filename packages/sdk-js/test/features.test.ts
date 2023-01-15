import {
  configureCache,
  Context,
  GrowthBook,
  resetFeatureRepository,
  setPolyfills,
} from "../src";

/* eslint-disable */
const { webcrypto } = require("node:crypto");
import { TextEncoder, TextDecoder } from "util";
global.TextEncoder = TextEncoder;
(global as any).TextDecoder = TextDecoder;
const { MockEvent, EventSource } = require("mocksse");
require("jest-localstorage-mock");
/* eslint-enable */

setPolyfills({
  EventSource,
});

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

    await new Promise<void>((resolve) => {
      window.setTimeout(() => {
        resolve();
      }, 100);
    });

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

    await new Promise<void>((resolve) => {
      window.setTimeout(() => {
        resolve();
      }, 100);
    });

    expect(mock.mock.calls.length).toEqual(0);
    window.fetch = f;
  });

  it("debounces fetch requests", async () => {
    resetFeatureRepository();

    // Value from api is "initial"
    const fooVal = "initial";
    const f = jest.fn((url: string) => {
      return new Promise((resolve) => {
        setTimeout(() => {
          resolve({
            headers: {
              get: () => null,
            },
            url,
            json: () =>
              Promise.resolve({
                features: {
                  foo: {
                    defaultValue: fooVal,
                  },
                },
              }),
          });
        }, 200);
      });
    });

    setPolyfills({
      fetch: f,
    });

    const growthbook1 = new GrowthBook({
      apiHost: "https://fakeapi.sample.io",
      clientKey: "qwerty1234",
    });
    const growthbook2 = new GrowthBook({
      apiHost: "https://fakeapi.sample.io",
      clientKey: "other",
    });
    const growthbook3 = new GrowthBook({
      apiHost: "https://fakeapi.sample.io/",
      clientKey: "qwerty1234",
    });

    await Promise.all([
      growthbook1.loadFeatures(),
      growthbook2.loadFeatures(),
      growthbook3.loadFeatures(),
    ]);

    expect(f.mock.calls.length).toEqual(2);
    expect(f.mock.calls[0][0]).toEqual(
      "https://fakeapi.sample.io/api/features/qwerty1234"
    );
    expect(f.mock.calls[1][0]).toEqual(
      "https://fakeapi.sample.io/api/features/other"
    );

    expect(growthbook1.evalFeature("foo").value).toEqual("initial");
    expect(growthbook2.evalFeature("foo").value).toEqual("initial");
    expect(growthbook3.evalFeature("foo").value).toEqual("initial");

    resetFeatureRepository();
    growthbook1.destroy();
    growthbook2.destroy();
    growthbook3.destroy();

    setPolyfills({
      fetch: null,
    });
  });

  it("uses cache and updates via polling", async () => {
    resetFeatureRepository();

    // Value from api is "initial"
    let fooVal = "initial";
    const f = jest.fn(() => {
      return Promise.resolve({
        headers: {
          get: () => null,
        },
        json: () =>
          Promise.resolve({
            features: {
              foo: {
                defaultValue: fooVal,
              },
            },
          }),
      });
    });
    setPolyfills({
      fetch: f,
    });

    configureCache({
      pollingInterval: 100,
      staleTTL: 500,
    });

    const growthbook = new GrowthBook({
      apiHost: "https://fakeapi.sample.io",
      clientKey: "qwerty1234",
    });
    // Initial value of feature should be null
    expect(growthbook.evalFeature("foo").value).toEqual(null);

    expect(f.mock.calls.length).toEqual(1);

    // Once features are loaded, value should be from the fetch request
    await growthbook.loadFeatures({ autoUpdate: true });
    expect(growthbook.evalFeature("foo").value).toEqual("initial");

    expect(f.mock.calls.length).toEqual(1);

    // Value changes in API
    fooVal = "changed";

    // New instances should get cached value
    const growthbook2 = new GrowthBook({
      apiHost: "https://fakeapi.sample.io",
      clientKey: "qwerty1234",
    });
    expect(growthbook2.evalFeature("foo").value).toEqual(null);
    await growthbook2.loadFeatures();
    expect(growthbook2.evalFeature("foo").value).toEqual("initial");

    expect(f.mock.calls.length).toEqual(1);

    // Old instances should also get cached value
    expect(growthbook.evalFeature("foo").value).toEqual("initial");

    // Wait a bit for cache to expire and polling to update
    await new Promise((resolve) => setTimeout(resolve, 750));

    expect(f.mock.calls.length).toEqual(2);

    // The instance with `autoUpdate` should now have the new value
    expect(growthbook.evalFeature("foo").value).toEqual("changed");

    // The instance without `autoUpdate` should continue to have the old value
    expect(growthbook2.evalFeature("foo").value).toEqual("initial");

    // New instances should get the new value
    const growthbook3 = new GrowthBook({
      apiHost: "https://fakeapi.sample.io",
      clientKey: "qwerty1234",
    });
    expect(growthbook3.evalFeature("foo").value).toEqual(null);
    await growthbook3.loadFeatures();
    expect(growthbook3.evalFeature("foo").value).toEqual("changed");

    expect(f.mock.calls.length).toEqual(2);

    resetFeatureRepository();
    growthbook.destroy();
    growthbook2.destroy();
    growthbook3.destroy();

    setPolyfills({
      fetch: null,
    });
  });

  it("uses localStorage cache", async () => {
    resetFeatureRepository();

    localStorage.setItem(
      "growthbook:cache:features",
      JSON.stringify([
        [
          "https://fakeapi.sample.io||qwerty1234",
          {
            staleAt: new Date(Date.now() + 500),
            data: {
              features: {
                foo: {
                  defaultValue: "localstorage",
                },
              },
            },
          },
        ],
      ])
    );

    let apiValue = "api";
    let apiVersion = "2020-01-01T00:00:00Z";
    const f = jest.fn(() => {
      return Promise.resolve({
        headers: {
          get: () => null,
        },
        json: () =>
          Promise.resolve({
            features: {
              foo: {
                defaultValue: apiValue,
              },
            },
            dateUpdated: apiVersion,
          }),
      });
    });

    setPolyfills({
      fetch: f,
    });
    configureCache({
      pollingInterval: 100,
      staleTTL: 500,
    });

    const growthbook = new GrowthBook({
      apiHost: "https://fakeapi.sample.io",
      clientKey: "qwerty1234",
    });
    // Initial value of feature should be null
    expect(growthbook.evalFeature("foo").value).toEqual(null);

    // Once features are loaded, value should be from localStorage
    await growthbook.loadFeatures({ autoUpdate: true });
    expect(growthbook.evalFeature("foo").value).toEqual("localstorage");

    expect(f.mock.calls.length).toEqual(0);

    // Wait for localStorage entry to expire and background sync to pick up api value
    await new Promise((resolve) => setTimeout(resolve, 750));
    expect(f.mock.calls.length).toEqual(1);
    expect(growthbook.evalFeature("foo").value).toEqual("api");

    apiValue = "new";
    apiVersion = "2020-02-01T00:00:00Z";
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(f.mock.calls.length).toEqual(2);
    expect(growthbook.evalFeature("foo").value).toEqual("new");

    const lsValue = JSON.parse(
      localStorage.getItem("growthbook:cache:features") || "[]"
    );
    expect(lsValue.length).toEqual(1);
    expect(lsValue[0][0]).toEqual("https://fakeapi.sample.io||qwerty1234");
    expect(lsValue[0][1].version).toEqual(apiVersion);
    expect(lsValue[0][1].data.features).toEqual({
      foo: {
        defaultValue: "new",
      },
    });

    resetFeatureRepository();
    growthbook.destroy();

    setPolyfills({
      fetch: null,
    });
  });

  it("updates features based on SSE", async () => {
    resetFeatureRepository();

    const f = jest.fn(() => {
      return Promise.resolve({
        headers: {
          get: (header: string) =>
            header === "x-sse-support" ? "enabled" : undefined,
        },
        json: () =>
          Promise.resolve({
            features: {
              foo: {
                defaultValue: "initial",
              },
            },
          }),
      });
    });

    setPolyfills({
      fetch: f,
    });

    // Simulate SSE data
    new MockEvent({
      url: "https://fakeapi.sample.io/sub/qwerty1234",
      setInterval: 500,
      responses: [
        {
          type: "features",
          data: JSON.stringify({
            features: {
              foo: {
                defaultValue: "changed",
              },
            },
          }),
        },
      ],
    });

    const growthbook = new GrowthBook({
      apiHost: "https://fakeapi.sample.io",
      clientKey: "qwerty1234",
    });
    const growthbook2 = new GrowthBook({
      apiHost: "https://fakeapi.sample.io",
      clientKey: "qwerty1234",
    });

    expect(growthbook.evalFeature("foo").value).toEqual(null);
    expect(growthbook2.evalFeature("foo").value).toEqual(null);

    await Promise.all([
      growthbook.loadFeatures(),
      growthbook2.loadFeatures({ autoUpdate: true }),
    ]);

    expect(f.mock.calls.length).toEqual(1);

    // Initial value from API
    expect(growthbook.evalFeature("foo").value).toEqual("initial");
    expect(growthbook2.evalFeature("foo").value).toEqual("initial");

    // After SSE update received, instance with autoUpdate should have new value
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(growthbook.evalFeature("foo").value).toEqual("initial");
    expect(growthbook2.evalFeature("foo").value).toEqual("changed");

    expect(f.mock.calls.length).toEqual(1);

    resetFeatureRepository();
    growthbook.destroy();
    growthbook2.destroy();

    setPolyfills({
      fetch: null,
    });
  });
});
