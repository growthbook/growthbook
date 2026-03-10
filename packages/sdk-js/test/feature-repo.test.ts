import cloneDeep from "lodash/cloneDeep";
import {
  configureCache,
  GrowthBook,
  clearCache,
  setPolyfills,
  FeatureApiResponse,
  prefetchPayload,
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

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
function mockApi(
  data: FeatureApiResponse | null,
  supportSSE: boolean = false,
  delay: number = 50,
) {
  const f = jest.fn((url: string) => {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          status: data ? 200 : 500,
          ok: !!data,
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
  sse: boolean = false,
  apiHost: ApiHost = "https://fakeapi.sample.io",
  clientKey: ClientKey = "qwerty1234",
  feature: string = "foo",
  value: string = "localstorage",
  staleAt: number = 50,
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
          sse,
        },
      ],
    ]),
  );
}

describe("feature-repo", () => {
  beforeEach(async () => {
    await clearCache();
    configureCache({
      staleTTL: 100,
      maxAge: 2000,
      cacheKey: localStorageCacheKey,
      backgroundSync: true,
      disableCache: false,
    });
  });
  afterEach(async () => {
    await clearCache();
  });

  it("debounces fetch requests", async () => {
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

    growthbook1.destroy();
    growthbook2.destroy();
    growthbook3.destroy();

    cleanup();
  });

  it("prefetches", async () => {
    const apiPayload = {
      features: {
        foo: {
          defaultValue: "api",
        },
      },
      experiments: [],
      dateUpdated: "2000-05-01T00:00:12Z",
    };

    const [f, cleanup] = mockApi(apiPayload);

    await prefetchPayload({
      apiHost: "https://fakeapi.sample.io",
      clientKey: "sdk-abc123",
    });
    expect(f.mock.calls.length).toEqual(1);

    // New instance uses prefetched value
    const growthbook = new GrowthBook({
      apiHost: "https://fakeapi.sample.io",
      clientKey: "sdk-abc123",
    });
    await growthbook.init();
    expect(f.mock.calls.length).toEqual(1);
    expect(growthbook.evalFeature("foo").value).toEqual("api");
    expect(growthbook.getPayload()).toEqual(apiPayload);

    growthbook.destroy();
    cleanup();
  });

  it("uses cache and can refresh manually", async () => {
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
    expect(f.mock.calls.length).toEqual(0);

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
      subscribeToChanges: true,
    });
    expect(growthbook2.evalFeature("foo").value).toEqual(null);
    await growthbook2.loadFeatures();
    expect(growthbook2.evalFeature("foo").value).toEqual("initial");

    // Instance with `autoRefresh`
    const growthbook3 = new GrowthBook({
      apiHost: "https://fakeapi.sample.io",
      clientKey: "qwerty1234",
    });
    expect(growthbook3.evalFeature("foo").value).toEqual(null);
    await growthbook3.loadFeatures({ autoRefresh: true });
    expect(growthbook3.evalFeature("foo").value).toEqual("initial");

    // Instance without autoRefresh or subscribeToChanges
    const growthbook4 = new GrowthBook({
      apiHost: "https://fakeapi.sample.io",
      clientKey: "qwerty1234",
    });
    expect(growthbook4.evalFeature("foo").value).toEqual(null);
    await growthbook4.loadFeatures();
    expect(growthbook4.evalFeature("foo").value).toEqual("initial");

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

    // The instance with `subscribeToChanges` should now have the new value
    expect(growthbook2.evalFeature("foo").value).toEqual("changed");

    // The instance with `autoRefresh` should now have the new value
    expect(growthbook3.evalFeature("foo").value).toEqual("changed");

    // The instance without `autoRefresh` or `subscribeToChanges` should still have the old value
    expect(growthbook4.evalFeature("foo").value).toEqual("initial");

    // New instances should get the new value
    const growthbook5 = new GrowthBook({
      apiHost: "https://fakeapi.sample.io",
      clientKey: "qwerty1234",
    });
    expect(growthbook5.evalFeature("foo").value).toEqual(null);
    await growthbook5.loadFeatures();
    expect(growthbook5.evalFeature("foo").value).toEqual("changed");

    expect(f.mock.calls.length).toEqual(2);

    growthbook.destroy();
    growthbook2.destroy();
    growthbook3.destroy();
    growthbook4.destroy();
    growthbook5.destroy();

    cleanup();
  });

  it("uses localStorage cache", async () => {
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
    await sleep(120);
    await growthbook.refreshFeatures();
    expect(f.mock.calls.length).toEqual(1);
    expect(growthbook.evalFeature("foo").value).toEqual("api");
    const staleAt = new Date(
      JSON.parse(
        localStorage.getItem(localStorageCacheKey) || "[]",
      )[0][1].staleAt,
    ).getTime();

    // Wait for localStorage entry to expire again
    // Since the payload didn't change, make sure it updates localStorage staleAt flag
    await sleep(120);
    await growthbook.refreshFeatures();
    expect(f.mock.calls.length).toEqual(2);
    expect(growthbook.evalFeature("foo").value).toEqual("api");
    const newStaleAt = new Date(
      JSON.parse(
        localStorage.getItem(localStorageCacheKey) || "[]",
      )[0][1].staleAt,
    ).getTime();
    expect(newStaleAt).toBeGreaterThan(staleAt);

    // If api has a new version, refreshFeatures should pick it up
    data.features.foo.defaultValue = "new";
    data.dateUpdated = "2020-02-01T00:00:00Z";
    await sleep(120);
    await growthbook.refreshFeatures();
    expect(f.mock.calls.length).toEqual(3);
    expect(growthbook.evalFeature("foo").value).toEqual("new");

    const lsValue = JSON.parse(
      localStorage.getItem(localStorageCacheKey) || "[]",
    );
    expect(lsValue.length).toEqual(1);
    expect(lsValue[0][0]).toEqual("https://fakeapi.sample.io||qwerty1234");
    expect(lsValue[0][1].version).toEqual(data.dateUpdated);
    expect(lsValue[0][1].data.features).toEqual({
      foo: {
        defaultValue: "new",
      },
    });

    growthbook.destroy();
    cleanup();
  });

  it("restores SSE state from cache", async () => {
    await seedLocalStorage(true);

    const [f, cleanup] = mockApi(
      {
        features: {
          foo: {
            defaultValue: "initial",
          },
        },
      },
      true,
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

    expect(growthbook.evalFeature("foo").value).toEqual(null);

    await growthbook.loadFeatures({ autoRefresh: true });

    // Should not hit API
    expect(f.mock.calls.length).toEqual(0);

    // Initial value from cache
    expect(growthbook.evalFeature("foo").value).toEqual("localstorage");

    // Should start SSE connection based on cache
    await sleep(100);
    expect(growthbook.evalFeature("foo").value).toEqual("changed");

    // Should still not hit the API
    expect(f.mock.calls.length).toEqual(0);

    growthbook.destroy();
    cleanup();
    event.clear();
  });

  it("prefetches with SSE", async () => {
    const apiPayload = {
      features: {
        foo: {
          defaultValue: "api",
        },
      },
      experiments: [],
      dateUpdated: "2000-05-01T00:00:12Z",
    };

    const [f, cleanup] = mockApi(apiPayload, true);

    const streamingPayload = {
      features: {
        foo: {
          defaultValue: "streaming",
        },
      },
      experiments: [],
      dateUpdated: "2010-05-01T00:00:12Z",
    };

    // Simulate SSE data
    const event = new MockEvent({
      url: "https://fakeapi.sample.io/sub/sdk-abc123",
      setInterval: 50,
      responses: [
        {
          type: "features",
          data: JSON.stringify(streamingPayload),
        },
      ],
    });

    await prefetchPayload({
      apiHost: "https://fakeapi.sample.io",
      clientKey: "sdk-abc123",
      streaming: true,
    });
    expect(f.mock.calls.length).toEqual(1);

    // New instance without streaming
    const growthbook = new GrowthBook({
      apiHost: "https://fakeapi.sample.io",
      clientKey: "sdk-abc123",
    });
    await growthbook.init();
    expect(f.mock.calls.length).toEqual(1);
    expect(growthbook.evalFeature("foo").value).toEqual("api");
    expect(growthbook.getPayload()).toEqual(apiPayload);

    // New instance with streaming
    const growthbook2 = new GrowthBook({
      apiHost: "https://fakeapi.sample.io",
      clientKey: "sdk-abc123",
    });
    await growthbook2.init({ streaming: true });
    expect(f.mock.calls.length).toEqual(1);
    expect(growthbook2.evalFeature("foo").value).toEqual("api");
    expect(growthbook2.getPayload()).toEqual(apiPayload);

    // Wait for SSE
    await sleep(100);

    // New instance without streaming should still have the old value
    expect(growthbook.evalFeature("foo").value).toEqual("api");
    expect(growthbook.getPayload()).toEqual(apiPayload);

    // New instance with streaming should have the new value
    expect(growthbook2.evalFeature("foo").value).toEqual("streaming");
    expect(growthbook2.getPayload()).toEqual(streamingPayload);

    // New instance created should use the latest streaming value
    const growthbook3 = new GrowthBook({
      apiHost: "https://fakeapi.sample.io",
      clientKey: "sdk-abc123",
    });
    await growthbook3.init();
    expect(growthbook3.evalFeature("foo").value).toEqual("streaming");

    // Make sure the cache was updated
    const lsValue = JSON.parse(
      localStorage.getItem(localStorageCacheKey) || "[]",
    );
    expect(lsValue.length).toEqual(1);
    expect(lsValue[0][0]).toEqual("https://fakeapi.sample.io||sdk-abc123");
    expect(lsValue[0][1].sse).toEqual(true);

    growthbook.destroy();
    growthbook2.destroy();
    growthbook3.destroy();
    cleanup();
    event.clear();
  });

  it("Can use streaming with init({payload})", async () => {
    const apiPayload = {
      features: {
        foo: {
          defaultValue: "api",
        },
      },
      experiments: [],
      dateUpdated: "2000-05-01T00:00:12Z",
    };

    const [f, cleanup] = mockApi(apiPayload, true);

    const hydratedPayload = {
      features: {
        foo: {
          defaultValue: "initial",
        },
      },
      experiments: [],
      dateUpdated: "2010-05-01T00:00:12Z",
    };

    const streamingPayload = {
      features: {
        foo: {
          defaultValue: "streaming",
        },
      },
      experiments: [],
      dateUpdated: "2020-05-01T00:00:12Z",
    };

    // Mock SSE
    const event = new MockEvent({
      url: "https://fakeapi.sample.io/sub/sdk-abc123",
      setInterval: 50,
      responses: [
        {
          type: "features",
          data: JSON.stringify(streamingPayload),
        },
      ],
    });

    const growthbook = new GrowthBook({
      apiHost: "https://fakeapi.sample.io",
      clientKey: "sdk-abc123",
    });
    await growthbook.init({ payload: hydratedPayload, streaming: true });

    // Initial value from hydrated payload
    expect(growthbook.evalFeature("foo").value).toEqual("initial");

    // Wait for SSE
    await sleep(100);

    // Value should be updated
    expect(growthbook.evalFeature("foo").value).toEqual("streaming");

    // Ensure fetch was never called
    expect(f.mock.calls.length).toEqual(0);

    growthbook.destroy();
    cleanup();
    event.clear();
  });

  it("updates features based on SSE", async () => {
    const [f, cleanup] = mockApi(
      {
        features: {
          foo: {
            defaultValue: "initial",
          },
        },
      },
      true,
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

    // Cache SSE value
    const lsValue = JSON.parse(
      localStorage.getItem(localStorageCacheKey) || "[]",
    );
    expect(lsValue.length).toEqual(1);
    expect(lsValue[0][0]).toEqual("https://fakeapi.sample.io||qwerty1234");
    expect(lsValue[0][1].sse).toEqual(true);

    growthbook.destroy();
    growthbook2.destroy();
    cleanup();
    event.clear();
  });

  it("automatically refreshes localStorage cache in the background when stale", async () => {
    await seedLocalStorage(
      false,
      "https://fakeapi.sample.io",
      "qwerty1234",
      "foo",
      "localstorage",
      -1000,
    );

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
      subscribeToChanges: true,
    });
    // Initial value of feature should be null
    expect(growthbook.evalFeature("foo").value).toEqual(null);

    // Once features are loaded, value should be from localstorage (skip localStorage)
    await growthbook.loadFeatures();
    expect(growthbook.evalFeature("foo").value).toEqual("localstorage");

    await sleep(100);

    // Should refresh in the background and features should now have the new value
    expect(f.mock.calls.length).toEqual(1);
    expect(growthbook.evalFeature("foo").value).toEqual("api");

    growthbook.destroy();
    cleanup();
  });

  it("doesn't restore from localStorage cache when ttl is more than maxAge", async () => {
    await seedLocalStorage(
      false,
      "https://fakeapi.sample.io",
      "qwerty1234",
      "foo",
      "localstorage",
      -3000,
    );

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
    });
    // Initial value of feature should be null
    expect(growthbook.evalFeature("foo").value).toEqual(null);

    // Once features are loaded, value should be from api (skip localStorage)
    await growthbook.loadFeatures();
    expect(f.mock.calls.length).toEqual(1);
    expect(growthbook.evalFeature("foo").value).toEqual("api");

    // Still should update localStorage cache, just not read from it
    const lsValue = JSON.parse(
      localStorage.getItem(localStorageCacheKey) || "[]",
    );
    expect(lsValue.length).toEqual(1);
    expect(lsValue[0][0]).toEqual("https://fakeapi.sample.io||qwerty1234");
    expect(lsValue[0][1].version).toEqual(apiVersion);
    expect(lsValue[0][1].data.features).toEqual({
      foo: {
        defaultValue: "api",
      },
    });

    growthbook.destroy();
    cleanup();
  });

  it("doesn't cache when `disableCache` is true", async () => {
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
      disableCache: true,
    });
    // Initial value of feature should be null
    expect(growthbook.evalFeature("foo").value).toEqual(null);

    // Once features are loaded, value should be from api (skip localStorage)
    await growthbook.loadFeatures({ autoRefresh: true });
    expect(f.mock.calls.length).toEqual(1);
    expect(growthbook.evalFeature("foo").value).toEqual("api");

    // Still should update localStorage cache, just not read from it
    const lsValue = JSON.parse(
      localStorage.getItem(localStorageCacheKey) || "[]",
    );
    expect(lsValue.length).toEqual(1);
    expect(lsValue[0][0]).toEqual("https://fakeapi.sample.io||qwerty1234");
    expect(lsValue[0][1].version).toEqual(apiVersion);
    expect(lsValue[0][1].data.features).toEqual({
      foo: {
        defaultValue: "api",
      },
    });

    growthbook.destroy();
    cleanup();
  });

  it("exposes a gb.ready flag", async () => {
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

    growthbook.destroy();
    cleanup();
  });

  it("handles broken fetch responses gracefully", async () => {
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

    growthbook.destroy();
    cleanup();
  });

  it("handles super long API requests gracefully", async () => {
    const [f, cleanup] = mockApi(
      {
        features: {
          foo: {
            defaultValue: "api",
          },
        },
      },
      false,
      100,
    );

    const growthbook = new GrowthBook({
      apiHost: "https://fakeapi.sample.io",
      clientKey: "qwerty1234",
    });

    expect(growthbook.ready).toEqual(false);
    // Doesn't throw errors
    await growthbook.loadFeatures({ timeout: 20 });
    expect(f.mock.calls.length).toEqual(1);
    // Ready state changes to true
    expect(growthbook.ready).toEqual(true);
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

    growthbook.destroy();
    cleanup();
  });

  it("handles timeouts with init", async () => {
    const payload = {
      features: {
        foo: {
          defaultValue: "api",
        },
      },
    };
    const [f, cleanup] = mockApi(payload, false, 100);

    configureCache({
      staleTTL: 800,
    });

    const growthbook = new GrowthBook({
      apiHost: "https://fakeapi.sample.io",
      clientKey: "qwerty1234",
    });

    expect(growthbook.ready).toEqual(false);
    // Doesn't throw errors
    const res = await growthbook.init({ timeout: 20 });
    expect(f.mock.calls.length).toEqual(1);
    expect(growthbook.ready).toEqual(true);
    expect(growthbook.getFeatures()).toEqual({});
    expect(res.success).toEqual(false);
    expect(res.source).toEqual("timeout");
    expect(res.error?.message).toEqual("Timeout");
    growthbook.destroy();

    // After fetch finished in the background, creating a new instance should work
    await sleep(200);
    const growthbook2 = new GrowthBook({
      apiHost: "https://fakeapi.sample.io",
      clientKey: "qwerty1234",
    });
    const res2 = await growthbook2.init({ timeout: 20 });
    expect(res2.success).toEqual(true);
    expect(growthbook2.getFeatures()).toEqual(payload.features);
    expect(res2.source).toEqual("cache");
    expect(res2.error).toEqual(undefined);
    growthbook2.destroy();

    clearCache();

    // Another instance with a longer timeout should return from network
    const growthbook3 = new GrowthBook({
      apiHost: "https://fakeapi.sample.io",
      clientKey: "querty1234",
    });
    const res3 = await growthbook3.init({ timeout: 200 });
    expect(res3.success).toEqual(true);
    expect(growthbook3.getFeatures()).toEqual(payload.features);
    expect(res3.source).toEqual("network");
    expect(res3.error).toEqual(undefined);
    growthbook3.destroy();

    cleanup();
  });

  it("handles errors with init", async () => {
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
    const res = await growthbook.init();
    // Attempts network request, logs the error
    expect(f.mock.calls.length).toEqual(1);
    expect(log.mock.calls.length).toEqual(1);
    expect(log.mock.calls[0][0]).toEqual("Error fetching features");

    // Ready state changes to true
    expect(growthbook.ready).toEqual(true);
    expect(growthbook.getFeatures()).toEqual({});

    // init response indicates an error
    expect(res.success).toEqual(false);
    expect(res.source).toEqual("error");
    expect(res.error?.message).toEqual("HTTP error: 500");

    const payload = {
      features: {
        foo: { defaultValue: "a" },
      },
    };
    await growthbook.setPayload(payload);

    // Refreshing with an error, logs the error, but doesn't overwrite the payload
    await growthbook.refreshFeatures();
    expect(growthbook.getFeatures()).toEqual(payload.features);
    expect(f.mock.calls.length).toEqual(2);
    expect(log.mock.calls.length).toEqual(2);
    expect(log.mock.calls[1][0]).toEqual("Error fetching features");

    growthbook.destroy();
    cleanup();
  });

  it("Handles SSE errors gracefuly", async () => {
    const [f, cleanup] = mockApi(
      {
        features: {
          foo: {
            defaultValue: "initial",
          },
        },
      },
      true,
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

    growthbook.destroy();
    cleanup();
    event.clear();
  });

  it("handles localStorage errors gracefully", async () => {
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
      true,
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

    growthbook.destroy();
    growthbook2.destroy();
    cleanup();
    event.clear();
  });

  it("doesn't do background sync when backgroundSync is set to false", async () => {
    const [f, cleanup] = mockApi(
      {
        features: {
          foo: {
            defaultValue: "initial",
          },
        },
      },
      true,
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

    // At least one instance needs to set `backgroundSync` to false for it to disable all SSE
    const growthbook = new GrowthBook({
      apiHost: "https://fakeapi.sample.io",
      clientKey: "qwerty1234",
      backgroundSync: false,
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

    growthbook.destroy();
    growthbook2.destroy();
    cleanup();
    event.clear();
  });

  it("decrypts features correctly", async () => {
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
  });

  it("loads features from a hydrated payload", async () => {
    // Value from api is "initial"
    const apiFeatures = {
      foo: {
        defaultValue: "api",
      },
    };
    const hydratedFeatures = {
      foo: {
        defaultValue: "hydrated",
      },
    };
    const [f, cleanup] = mockApi({ features: apiFeatures });

    const growthbook = new GrowthBook({
      apiHost: "https://fakeapi.sample.io",
      clientKey: "qwerty1234",
    });
    // Initial value of feature should be null
    expect(growthbook.evalFeature("foo").value).toEqual(null);
    expect(f.mock.calls.length).toEqual(0);

    // Calling init() moves the payload into the feature repo. It is available for use
    await growthbook.init({
      payload: {
        features: hydratedFeatures,
      },
    });
    expect(growthbook.evalFeature("foo").value).toEqual("hydrated");
    expect(f.mock.calls.length).toEqual(0);

    // Once cache expires, subsequent refreshFeatures() calls will pull from the API
    await sleep(2100);
    await growthbook.refreshFeatures();
    expect(growthbook.evalFeature("foo").value).toEqual("api");
    expect(f.mock.calls.length).toEqual(1);

    // We can force the SDK to use a new payload that overwrites the one from the api
    hydratedFeatures.foo.defaultValue = "new hydrated value";
    await growthbook.setPayload({ features: hydratedFeatures });
    expect(growthbook.evalFeature("foo").value).toEqual("new hydrated value");
    expect(f.mock.calls.length).toEqual(1);

    growthbook.destroy();
    cleanup();
  });

  it("preserves both an encrypted and unencrypted payload", async () => {
    const encryptedFeatures =
      "vMSg2Bj/IurObDsWVmvkUg==.L6qtQkIzKDoE2Dix6IAKDcVel8PHUnzJ7JjmLjFZFQDqidRIoCxKmvxvUj2kTuHFTQ3/NJ3D6XhxhXXv2+dsXpw5woQf0eAgqrcxHrbtFORs18tRXRZza7zqgzwvcznx";

    const growthbook = new GrowthBook({
      apiHost: "https://fakeapi.sample.io",
      clientKey: "qwerty1234",
      decryptionKey: "Ns04T5n9+59rl2x3SlNHtQ==",
    });
    // Initial value of feature should be null
    expect(growthbook.evalFeature("testfeature1").value).toEqual(null);

    // Calling init() moves the payload into the feature repo. It is available for use
    await growthbook.init({
      payload: {
        encryptedFeatures,
      },
    });
    expect(growthbook.evalFeature("testfeature1").value).toEqual(true);

    expect(growthbook.getPayload()).toEqual({
      encryptedFeatures:
        "vMSg2Bj/IurObDsWVmvkUg==.L6qtQkIzKDoE2Dix6IAKDcVel8PHUnzJ7JjmLjFZFQDqidRIoCxKmvxvUj2kTuHFTQ3/NJ3D6XhxhXXv2+dsXpw5woQf0eAgqrcxHrbtFORs18tRXRZza7zqgzwvcznx",
    });

    expect(growthbook.getDecryptedPayload()).toEqual({
      features: {
        testfeature1: {
          defaultValue: true,
          rules: [
            {
              condition: { id: "1234" },
              force: false,
            },
          ],
        },
      },
    });

    growthbook.destroy();
  });

  it("can disableCache", async () => {
    // Mock API
    const [f, cleanup] = mockApi({
      features: {
        foo: {
          defaultValue: "api",
        },
      },
    });

    // Disable localCache
    configureCache({
      disableCache: true,
    });

    // Each new GrowthBook instance hits the API
    const growthbook = new GrowthBook({
      apiHost: "https://fakeapi.sample.io",
      clientKey: "sdk-abc123",
    });
    await growthbook.init();
    expect(growthbook.evalFeature("foo").value).toEqual("api");
    expect(f.mock.calls.length).toEqual(1);

    // New instance should hit the API
    const growthbook2 = new GrowthBook({
      apiHost: "https://fakeapi.sample.io",
      clientKey: "sdk-abc123",
    });
    await growthbook2.init();
    expect(growthbook2.evalFeature("foo").value).toEqual("api");
    expect(f.mock.calls.length).toEqual(2);

    // Local cache should be empty
    expect(localStorage.getItem(localStorageCacheKey)).toEqual("[]");

    growthbook.destroy();
    growthbook2.destroy();
    cleanup();
  });
});
