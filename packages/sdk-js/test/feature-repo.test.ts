import cloneDeep from "lodash/cloneDeep";
import {
  configureCache,
  GrowthBook,
  clearCache,
  setPolyfills,
  FeatureApiResponse,
} from "../src";

/* eslint-disable */
const { webcrypto } = require("node:crypto");
import { TextEncoder, TextDecoder } from "util";
import { ApiHost, ClientKey } from "../src/types/growthbook";
global.TextEncoder = TextEncoder;
(global as any).TextDecoder = TextDecoder;
const { MockEvent, EventSource } = require("mocksse");
require("jest-localstorage-mock");
/* eslint-enable */

setPolyfills({
  EventSource,
  localStorage,
  SubtleCrypto: webcrypto.subtle,
});
const localStorageCacheKey = "growthbook:cache:features";
configureCache({
  staleTTL: 100,
  cacheKey: localStorageCacheKey,
});

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
function mockApi(
  data: FeatureApiResponse | null,
  supportSSE: boolean = false,
  delay: number = 50
) {
  const f = jest.fn((url: string) => {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          headers: {
            get: (header: string) =>
              header === "x-sse-support" && supportSSE ? "enabled" : undefined,
          },
          url,
          json: () =>
            data
              ? Promise.resolve(cloneDeep(data))
              : Promise.reject("Fetch error"),
        });
      }, delay);
    });
  });

  setPolyfills({
    fetch: f,
  });

  return [
    f,
    () => {
      setPolyfills({ fetch: undefined });
    },
  ] as const;
}

async function seedLocalStorage(
  apiHost: ApiHost = "https://fakeapi.sample.io",
  clientKey: ClientKey = "qwerty1234",
  feature: string = "foo",
  value: string = "localstorage",
  staleAt: number = 50
) {
  await clearCache();
  localStorage.setItem(
    localStorageCacheKey,
    JSON.stringify([
      [
        `${apiHost}||${clientKey}`,
        {
          staleAt: new Date(Date.now() + staleAt),
          data: {
            features: {
              [feature]: {
                defaultValue: value,
              },
            },
          },
        },
      ],
    ])
  );
}

describe("feature-repo", () => {
  it("debounces fetch requests", async () => {
    await clearCache();

    const [f, cleanup] = mockApi({
      features: {
        foo: {
          defaultValue: "initial",
        },
      },
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
    const urls = [f.mock.calls[0][0], f.mock.calls[1][0]].sort();
    expect(urls).toEqual([
      "https://fakeapi.sample.io/api/features/other",
      "https://fakeapi.sample.io/api/features/qwerty1234",
    ]);

    expect(growthbook1.evalFeature("foo").value).toEqual("initial");
    expect(growthbook2.evalFeature("foo").value).toEqual("initial");
    expect(growthbook3.evalFeature("foo").value).toEqual("initial");

    await clearCache();
    growthbook1.destroy();
    growthbook2.destroy();
    growthbook3.destroy();

    cleanup();
  });

  it("uses cache and can refresh manually", async () => {
    await clearCache();

    // Value from api is "initial"
    const features = {
      foo: {
        defaultValue: "initial",
      },
    };
    const [f, cleanup] = mockApi({ features });

    const growthbook = new GrowthBook({
      apiHost: "https://fakeapi.sample.io",
      clientKey: "qwerty1234",
    });
    await sleep(20);
    // Initial value of feature should be null
    expect(growthbook.evalFeature("foo").value).toEqual(null);
    expect(f.mock.calls.length).toEqual(1);

    // Once features are loaded, value should be from the fetch request
    await growthbook.loadFeatures();
    expect(growthbook.evalFeature("foo").value).toEqual("initial");
    expect(f.mock.calls.length).toEqual(1);

    // Value changes in API
    features.foo.defaultValue = "changed";

    // New instances should get cached value
    const growthbook2 = new GrowthBook({
      apiHost: "https://fakeapi.sample.io",
      clientKey: "qwerty1234",
    });
    expect(growthbook2.evalFeature("foo").value).toEqual(null);
    await growthbook2.loadFeatures({ autoRefresh: true });
    expect(growthbook2.evalFeature("foo").value).toEqual("initial");

    // Instance without autoRefresh
    const growthbook3 = new GrowthBook({
      apiHost: "https://fakeapi.sample.io",
      clientKey: "qwerty1234",
    });
    expect(growthbook3.evalFeature("foo").value).toEqual(null);
    await growthbook3.loadFeatures();
    expect(growthbook3.evalFeature("foo").value).toEqual("initial");

    expect(f.mock.calls.length).toEqual(1);

    // Old instances should also get cached value
    expect(growthbook.evalFeature("foo").value).toEqual("initial");

    // Refreshing while cache is fresh should not cause a new network request
    await growthbook.refreshFeatures();
    expect(f.mock.calls.length).toEqual(1);

    // Wait a bit for cache to become stale and refresh again
    await sleep(100);
    await growthbook.refreshFeatures();
    expect(f.mock.calls.length).toEqual(2);

    // The instance being updated should get the new value
    expect(growthbook.evalFeature("foo").value).toEqual("changed");

    // The instance with `autoRefresh` should now have the new value
    expect(growthbook2.evalFeature("foo").value).toEqual("changed");

    // The instance without `autoRefresh` should continue to have the old value
    expect(growthbook3.evalFeature("foo").value).toEqual("initial");

    // New instances should get the new value
    const growthbook4 = new GrowthBook({
      apiHost: "https://fakeapi.sample.io",
      clientKey: "qwerty1234",
    });
    expect(growthbook4.evalFeature("foo").value).toEqual(null);
    await growthbook4.loadFeatures();
    expect(growthbook4.evalFeature("foo").value).toEqual("changed");

    expect(f.mock.calls.length).toEqual(2);

    await clearCache();
    growthbook.destroy();
    growthbook2.destroy();
    growthbook3.destroy();
    growthbook4.destroy();

    cleanup();
  });

  it("uses localStorage cache", async () => {
    await clearCache();
    await seedLocalStorage();

    const data = {
      features: {
        foo: {
          defaultValue: "api",
        },
      },
      dateUpdated: "2020-01-01T00:00:00Z",
    };
    const [f, cleanup] = mockApi(data);

    const growthbook = new GrowthBook({
      apiHost: "https://fakeapi.sample.io",
      clientKey: "qwerty1234",
    });
    // Initial value of feature should be null
    expect(growthbook.evalFeature("foo").value).toEqual(null);

    // Once features are loaded, value should be from localStorage
    await growthbook.loadFeatures({ autoRefresh: true });
    expect(growthbook.evalFeature("foo").value).toEqual("localstorage");

    expect(f.mock.calls.length).toEqual(0);

    // Wait for localStorage entry to expire and refresh features
    await sleep(100);
    await growthbook.refreshFeatures();
    expect(f.mock.calls.length).toEqual(1);
    expect(growthbook.evalFeature("foo").value).toEqual("api");

    // If api has a new version, refreshFeatures should pick it up
    data.features.foo.defaultValue = "new";
    data.dateUpdated = "2020-02-01T00:00:00Z";
    await sleep(150);
    await growthbook.refreshFeatures();
    expect(f.mock.calls.length).toEqual(2);
    expect(growthbook.evalFeature("foo").value).toEqual("new");

    const lsValue = JSON.parse(
      localStorage.getItem(localStorageCacheKey) || "[]"
    );
    expect(lsValue.length).toEqual(1);
    expect(lsValue[0][0]).toEqual("https://fakeapi.sample.io||qwerty1234");
    expect(lsValue[0][1].version).toEqual(data.dateUpdated);
    expect(lsValue[0][1].data.features).toEqual({
      foo: {
        defaultValue: "new",
      },
    });

    await clearCache();
    growthbook.destroy();
    cleanup();
  });

  it("updates features based on SSE", async () => {
    await clearCache();

    const [f, cleanup] = mockApi(
      {
        features: {
          foo: {
            defaultValue: "initial",
          },
        },
      },
      true
    );

    // Simulate SSE data
    const event = new MockEvent({
      url: "https://fakeapi.sample.io/sub/qwerty1234",
      setInterval: 50,
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
      growthbook2.loadFeatures({ autoRefresh: true }),
    ]);

    expect(f.mock.calls.length).toEqual(1);

    // Initial value from API
    expect(growthbook.evalFeature("foo").value).toEqual("initial");
    expect(growthbook2.evalFeature("foo").value).toEqual("initial");

    // After SSE update received, instance with autoRefresh should have new value
    await sleep(100);
    expect(growthbook.evalFeature("foo").value).toEqual("initial");
    expect(growthbook2.evalFeature("foo").value).toEqual("changed");

    expect(f.mock.calls.length).toEqual(1);

    await clearCache();
    growthbook.destroy();
    growthbook2.destroy();
    cleanup();
    event.clear();
  });

  it("doesn't cache when `enableDevMode` is on", async () => {
    await clearCache();
    await seedLocalStorage();

    const apiVersion = "2025-01-01T00:00:00Z";
    const [f, cleanup] = mockApi({
      features: {
        foo: {
          defaultValue: "api",
        },
      },
      dateUpdated: apiVersion,
    });

    const growthbook = new GrowthBook({
      apiHost: "https://fakeapi.sample.io",
      clientKey: "qwerty1234",
      enableDevMode: true,
    });
    // Initial value of feature should be null
    expect(growthbook.evalFeature("foo").value).toEqual(null);

    // Once features are loaded, value should be from api (skip localStorage)
    await growthbook.loadFeatures({ autoRefresh: true });
    expect(f.mock.calls.length).toEqual(1);
    expect(growthbook.evalFeature("foo").value).toEqual("api");

    // Still should update localStorage cache, just not read from it
    const lsValue = JSON.parse(
      localStorage.getItem(localStorageCacheKey) || "[]"
    );
    expect(lsValue.length).toEqual(1);
    expect(lsValue[0][0]).toEqual("https://fakeapi.sample.io||qwerty1234");
    expect(lsValue[0][1].version).toEqual(apiVersion);
    expect(lsValue[0][1].data.features).toEqual({
      foo: {
        defaultValue: "api",
      },
    });

    await clearCache();
    growthbook.destroy();

    cleanup();
  });

  it("exposes a gb.ready flag", async () => {
    await clearCache();

    const [f, cleanup] = mockApi({
      features: {
        foo: {
          defaultValue: "api",
        },
      },
    });

    const growthbook = new GrowthBook({
      apiHost: "https://fakeapi.sample.io",
      clientKey: "qwerty1234",
      enableDevMode: true,
    });

    // Works when loaded from API
    expect(growthbook.ready).toEqual(false);
    await growthbook.loadFeatures();
    expect(f.mock.calls.length).toEqual(1);
    expect(growthbook.ready).toEqual(true);

    // Works when loaded manually
    growthbook.ready = false;
    growthbook.setFeatures({
      foo: {
        defaultValue: "manual",
      },
    });
    expect(growthbook.ready).toEqual(true);

    await clearCache();
    growthbook.destroy();
    cleanup();
  });

  it("handles broken fetch responses gracefully", async () => {
    await clearCache();

    const [f, cleanup] = mockApi(null);

    // eslint-disable-next-line
    const log = jest.fn((msg: string, ctx: Record<string, unknown>) => {
      // Do nothing
    });

    const growthbook = new GrowthBook({
      apiHost: "https://fakeapi.sample.io",
      clientKey: "qwerty1234",
      log,
    });
    growthbook.debug = true;

    expect(growthbook.ready).toEqual(false);
    await growthbook.loadFeatures();
    // Attempts network request, logs the error
    expect(f.mock.calls.length).toEqual(1);
    expect(log.mock.calls.length).toEqual(1);
    expect(log.mock.calls[0][0]).toEqual("Error fetching features");

    // Ready state changes to true
    expect(growthbook.ready).toEqual(true);
    expect(growthbook.getFeatures()).toEqual({});

    // Logs the error, doesn't cache result
    await growthbook.refreshFeatures();
    expect(growthbook.getFeatures()).toEqual({});
    expect(f.mock.calls.length).toEqual(2);
    expect(log.mock.calls.length).toEqual(2);
    expect(log.mock.calls[1][0]).toEqual("Error fetching features");

    await clearCache();
    growthbook.destroy();
    cleanup();
  });

  it("handles super long API requests gracefully", async () => {
    await clearCache();

    const [f, cleanup] = mockApi(
      {
        features: {
          foo: {
            defaultValue: "api",
          },
        },
      },
      false,
      100
    );

    const growthbook = new GrowthBook({
      apiHost: "https://fakeapi.sample.io",
      clientKey: "qwerty1234",
    });

    expect(growthbook.ready).toEqual(false);
    // Doesn't throw errors
    await growthbook.loadFeatures({ timeout: 20 });
    expect(f.mock.calls.length).toEqual(1);
    // Ready state remains false
    expect(growthbook.ready).toEqual(false);
    expect(growthbook.getFeatures()).toEqual({});

    // After fetch finished in the background, refreshing should actually finish in time
    await sleep(100);
    await growthbook.refreshFeatures({ timeout: 20 });
    expect(f.mock.calls.length).toEqual(1);
    expect(growthbook.ready).toEqual(true);
    expect(growthbook.getFeatures()).toEqual({
      foo: {
        defaultValue: "api",
      },
    });

    await clearCache();
    growthbook.destroy();
    cleanup();
  });

  it("Handles SSE errors gracefuly", async () => {
    await clearCache();

    const [f, cleanup] = mockApi(
      {
        features: {
          foo: {
            defaultValue: "initial",
          },
        },
      },
      true
    );

    // Simulate SSE data
    const event = new MockEvent({
      url: "https://fakeapi.sample.io/sub/qwerty1234",
      setInterval: 50,
      responses: [
        {
          type: "features",
          data: "broken(response",
        },
      ],
    });

    // eslint-disable-next-line
    const log = jest.fn((msg: string, ctx: Record<string, unknown>) => {
      // Do nothing
    });

    const growthbook = new GrowthBook({
      apiHost: "https://fakeapi.sample.io",
      clientKey: "qwerty1234",
      log,
    });

    expect(growthbook.evalFeature("foo").value).toEqual(null);

    await growthbook.loadFeatures({ autoRefresh: true });
    expect(f.mock.calls.length).toEqual(1);

    // Initial value from API
    expect(growthbook.evalFeature("foo").value).toEqual("initial");

    // After SSE fired, should log an error and feature value should remain the same
    growthbook.debug = true;
    await sleep(100);
    expect(log.mock.calls.length).toEqual(1);
    expect(log.mock.calls[0][0]).toEqual("SSE Error");
    growthbook.debug = false;
    expect(growthbook.evalFeature("foo").value).toEqual("initial");

    await clearCache();
    growthbook.destroy();
    cleanup();
    event.clear();
  });

  it("handles localStorage errors gracefully", async () => {
    clearCache();
    setPolyfills({
      localStorage: {
        setItem() {
          throw new Error("Localstorage disabled");
        },
        getItem() {
          throw new Error("Localstorage disabled");
        },
      },
    });
    const [f, cleanup] = mockApi({
      features: {
        foo: {
          defaultValue: "initial",
        },
      },
    });

    // No errors are thrown initializing the cache
    const growthbook = new GrowthBook({
      apiHost: "https://fakeapi.sample.io",
      clientKey: "qwerty1234",
    });
    // No errors are thrown writing to cache
    await growthbook.loadFeatures();
    expect(growthbook.evalFeature("foo").value).toEqual("initial");
    expect(f.mock.calls.length).toEqual(1);

    // No errors are thrown clearing the cache
    await clearCache();

    growthbook.destroy();
    cleanup();

    // Restore localStorage polyfill
    setPolyfills({
      localStorage: globalThis.localStorage,
    });
  });

  it("doesn't do background sync when disabled", async () => {
    await clearCache();
    configureCache({
      backgroundSync: false,
    });

    const [f, cleanup] = mockApi(
      {
        features: {
          foo: {
            defaultValue: "initial",
          },
        },
      },
      true
    );

    // Simulate SSE data
    const event = new MockEvent({
      url: "https://fakeapi.sample.io/sub/qwerty1234",
      setInterval: 50,
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
      growthbook2.loadFeatures({ autoRefresh: true }),
    ]);

    expect(f.mock.calls.length).toEqual(1);

    // Initial value from API
    expect(growthbook.evalFeature("foo").value).toEqual("initial");
    expect(growthbook2.evalFeature("foo").value).toEqual("initial");

    // SSE update is ignored
    await sleep(100);
    expect(growthbook.evalFeature("foo").value).toEqual("initial");
    expect(growthbook2.evalFeature("foo").value).toEqual("initial");

    expect(f.mock.calls.length).toEqual(1);

    await clearCache();
    growthbook.destroy();
    growthbook2.destroy();
    cleanup();
    event.clear();

    configureCache({
      backgroundSync: true,
    });
  });

  it("decrypts features correctly", async () => {
    await clearCache();
    const [f, cleanup] = mockApi({
      features: {},
      encryptedFeatures:
        "vMSg2Bj/IurObDsWVmvkUg==.L6qtQkIzKDoE2Dix6IAKDcVel8PHUnzJ7JjmLjFZFQDqidRIoCxKmvxvUj2kTuHFTQ3/NJ3D6XhxhXXv2+dsXpw5woQf0eAgqrcxHrbtFORs18tRXRZza7zqgzwvcznx",
    });

    const growthbook = new GrowthBook({
      apiHost: "https://fakeapi.sample.io",
      clientKey: "qwerty1234",
      decryptionKey: "Ns04T5n9+59rl2x3SlNHtQ==",
    });

    await growthbook.loadFeatures();

    expect(f.mock.calls.length).toEqual(1);

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
    cleanup();
    await clearCache();
  });
});
