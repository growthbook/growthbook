import cloneDeep from "lodash/cloneDeep";
import {
  configureCache,
  GrowthBook,
  clearCache,
  setPolyfills,
  FeatureApiResponse,
  LocalStorageStickyBucketService,
  BrowserCookieStickyBucketService,
  RedisStickyBucketService,
} from "../src";

/* eslint-disable */
const { webcrypto } = require("node:crypto");
import { TextEncoder, TextDecoder } from "util";
import { ApiHost, ClientKey } from "../src/types/growthbook";
import { evaluateFeatures, remoteEvalRedis } from "./helpers/evaluateFeatures";
global.TextEncoder = TextEncoder;
(global as any).TextDecoder = TextDecoder;
const { MockEvent, EventSource } = require("mocksse");
require("jest-localstorage-mock");
const Cookie = require("js-cookie");
const Redis = require("ioredis-mock");
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
  delay: number = 50,
) {
  // eslint-disable-next-line
  const f = jest.fn((url: string, resp: any) => {
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

function mockRemoteEvalApi(
  data: FeatureApiResponse | null,
  supportSSE: boolean = false,
  delay: number = 50,
) {
  // eslint-disable-next-line
  const f = jest.fn((url: string, resp: any) => {
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
          json: () => {
            const body = JSON.parse(resp.body);
            const {
              attributes,
              forcedVariations,
              forcedFeatures: forcedFeaturesArray,
              url: evalUrl,
            } = body;
            return data
              ? Promise.resolve(
                  evaluateFeatures({
                    payload: cloneDeep(data),
                    attributes,
                    forcedVariations,
                    forcedFeatures: new Map(forcedFeaturesArray),
                    url: evalUrl,
                    ctx: { enableStickyBucketing: true }, // non-standard property for testing purposes
                  }),
                )
              : Promise.reject("Fetch error");
          },
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

const sdkPayload: FeatureApiResponse = {
  features: {
    exp1: {
      defaultValue: "control",
      rules: [
        {
          key: "feature-exp",
          seed: "feature-exp",
          hashAttribute: "id",
          fallbackAttribute: "deviceId",
          hashVersion: 2,
          bucketVersion: 0,
          condition: { country: "USA" },
          variations: ["control", "red", "blue"],
          meta: [{ key: "0" }, { key: "1" }, { key: "2" }],
          coverage: 1,
          weights: [0.3334, 0.3333, 0.3333],
          phase: "0",
        },
      ],
    },
  },
  experiments: [
    {
      key: "manual-experiment",
      seed: "s1",
      hashAttribute: "id",
      fallbackAttribute: "anonymousId",
      hashVersion: 2,
      bucketVersion: 0,
      manual: true,
      variations: [
        {},
        {
          domMutations: [
            {
              selector: "h1",
              action: "set",
              attribute: "html",
              value: "red",
            },
          ],
        },
        {
          domMutations: [
            {
              selector: "h1",
              action: "set",
              attribute: "html",
              value: "blue",
            },
          ],
        },
      ],
      meta: [{ key: "0" }, { key: "1" }, { key: "2" }],
      weights: [0.3334, 0.3333, 0.3333],
      coverage: 1,
    },
  ],
};

describe("sticky-buckets", () => {
  it("reads, writes, and upgrades sticky buckets using localStorage driver", async () => {
    await clearCache();
    const [, cleanup] = mockApi(sdkPayload);

    // with sticky bucket support
    const growthbook1a = new GrowthBook({
      apiHost: "https://fakeapi.sample.io",
      clientKey: "qwerty1234",
      stickyBucketService: new LocalStorageStickyBucketService(),
      attributes: {
        deviceId: "d123",
        anonymousId: "ses123",
        foo: "bar",
        country: "USA",
      },
    });

    // no sticky bucket support (but enabled anyhow)
    const growthbook2a = new GrowthBook({
      apiHost: "https://fakeapi.sample.io",
      clientKey: "qwerty1234",
      attributes: {
        deviceId: "d123",
        anonymousId: "ses123",
        foo: "bar",
        country: "USA",
      },
    });

    await Promise.all([
      growthbook1a.loadFeatures(),
      growthbook2a.loadFeatures(),
    ]);
    await sleep(10);

    // evaluate based on fallbackAttribute "deviceId"
    let result1 = growthbook1a.evalFeature("exp1");
    let result2 = growthbook2a.evalFeature("exp1");
    expect(result1.value).toBe("red");
    expect(result2.value).toBe("control"); // cannot use fallbackAttribute, no hashAttribute

    let expResult1 = growthbook1a.triggerExperiment("manual-experiment")?.[0];
    let expResult2 = growthbook2a.triggerExperiment("manual-experiment")?.[0];
    expect(expResult1?.variationId).toBe(2);
    expect(expResult2?.variationId).toBe(0);

    growthbook1a.destroy();
    growthbook2a.destroy();
    // console.log("localStorage A", localStorage);
    await sleep(100);

    // provide the primary hashAttribute "id" as well as fallbackAttribute "deviceId"
    const growthbook1b = new GrowthBook({
      apiHost: "https://fakeapi.sample.io",
      clientKey: "qwerty1234",
      stickyBucketService: new LocalStorageStickyBucketService(),
      attributes: {
        deviceId: "d123",
        anonymousId: "ses123",
        id: "12345",
        foo: "bar",
        country: "USA",
      },
    });
    const growthbook2b = new GrowthBook({
      apiHost: "https://fakeapi.sample.io",
      clientKey: "qwerty1234",
      attributes: {
        deviceId: "d123",
        anonymousId: "ses123",
        id: "12345",
        foo: "bar",
        country: "USA",
      },
    });
    await Promise.all([
      growthbook1b.loadFeatures(),
      growthbook2b.loadFeatures(),
    ]);
    await sleep(10);

    result1 = growthbook1b.evalFeature("exp1");
    result2 = growthbook2b.evalFeature("exp1");
    expect(result1.value).toBe("red");
    expect(result2.value).toBe("blue");

    expResult1 = growthbook1b.triggerExperiment("manual-experiment")?.[0];
    expResult2 = growthbook2b.triggerExperiment("manual-experiment")?.[0];
    expect(expResult1?.variationId).toBe(2);
    expect(expResult2?.variationId).toBe(1);

    growthbook1b.destroy();
    growthbook2b.destroy();
    // console.log("localStorage B", localStorage);
    await sleep(100);

    // remove the fallbackAttribute "deviceId".
    // bucketing for "id" should have persisted in growthbook1 only
    const growthbook1c = new GrowthBook({
      apiHost: "https://fakeapi.sample.io",
      clientKey: "qwerty1234",
      stickyBucketService: new LocalStorageStickyBucketService(),
      attributes: {
        id: "12345",
        foo: "bar",
        country: "Canada", // <-- change the country to demonstrate that the bucket persists
      },
    });
    const growthbook2c = new GrowthBook({
      apiHost: "https://fakeapi.sample.io",
      clientKey: "qwerty1234",
      attributes: {
        id: "12345",
        foo: "bar",
        country: "USA",
      },
    });
    await Promise.all([
      growthbook1c.loadFeatures(),
      growthbook2c.loadFeatures(),
    ]);
    await sleep(10);

    result1 = growthbook1c.evalFeature("exp1");
    result2 = growthbook2c.evalFeature("exp1");
    expect(result1.value).toBe("red");
    expect(result2.value).toBe("blue");

    expResult1 = growthbook1c.triggerExperiment("manual-experiment")?.[0];
    expResult2 = growthbook2c.triggerExperiment("manual-experiment")?.[0];
    expect(expResult1?.variationId).toBe(2);
    expect(expResult2?.variationId).toBe(1);

    growthbook1c.destroy();
    growthbook2c.destroy();
    cleanup();
    // console.log("localStorage C", localStorage);

    localStorage.clear();
  });

  it("upgrades fallbackAttribute to hashAttribute during a single SDK session", async () => {
    await clearCache();
    const [, cleanup] = mockApi(sdkPayload);

    // with sticky bucket support
    const growthbook = new GrowthBook({
      apiHost: "https://fakeapi.sample.io",
      clientKey: "qwerty1234",
      stickyBucketService: new LocalStorageStickyBucketService(),
      attributes: {
        deviceId: "d123",
        anonymousId: "ses123",
        country: "USA",
      },
    });

    await growthbook.init();

    // evaluate based on fallbackAttribute "deviceId"
    const result1 = growthbook.evalFeature("exp1");
    expect(result1.value).toBe("red");

    const expResult1 = growthbook.triggerExperiment("manual-experiment")?.[0];
    expect(expResult1?.variationId).toBe(2);

    // provide the primary hashAttribute "id" as well as fallbackAttribute "deviceId"
    growthbook.setAttributes({
      ...growthbook.getAttributes(),
      id: "12345",
    });

    const result2 = growthbook.evalFeature("exp1");
    expect(result2.value).toBe("red");

    const expResult2 = growthbook.triggerExperiment("manual-experiment")?.[0];
    expect(expResult2?.variationId).toBe(2);

    // remove the fallbackAttribute "deviceId".
    // bucketing for "id" should have persisted
    growthbook.setAttributes({
      id: "12345",
      anonymousId: "ses123",
      country: "USA",
    });

    const result3 = growthbook.evalFeature("exp1");
    expect(result3.value).toBe("red");

    const expResult3 = growthbook.triggerExperiment("manual-experiment")?.[0];
    expect(expResult3?.variationId).toBe(2);

    growthbook.destroy();
    cleanup();
    // console.log("localStorage C", localStorage);

    localStorage.clear();
  });

  it("reads, writes, and upgrades sticky buckets using browser cookies driver", async () => {
    await clearCache();
    const [, cleanup] = mockApi(sdkPayload);

    // with sticky bucket support
    const growthbook1 = new GrowthBook({
      apiHost: "https://fakeapi.sample.io",
      clientKey: "qwerty1234",
      stickyBucketService: new BrowserCookieStickyBucketService({
        jsCookie: Cookie,
      }),
      attributes: {
        deviceId: "d123",
        anonymousId: "ses123",
        foo: "bar",
        country: "USA",
      },
    });
    await growthbook1.loadFeatures();
    await sleep(10);

    // evaluate based on fallbackAttribute "deviceId"
    const result1 = growthbook1.evalFeature("exp1");
    expect(result1.value).toBe("red");

    const expResult1 = growthbook1.triggerExperiment("manual-experiment")?.[0];
    expect(expResult1?.variationId).toBe(2);

    growthbook1.destroy();
    // console.log("cookie A", document.cookie);
    await sleep(100);

    // provide the primary hashAttribute "id" as well as fallbackAttribute "deviceId"
    const growthbook2 = new GrowthBook({
      apiHost: "https://fakeapi.sample.io",
      clientKey: "qwerty1234",
      stickyBucketService: new BrowserCookieStickyBucketService({
        jsCookie: Cookie,
      }),
      attributes: {
        deviceId: "d123",
        anonymousId: "ses123",
        id: "12345",
        foo: "bar",
        country: "USA",
      },
    });
    await growthbook2.loadFeatures();
    await sleep(10);

    const result2 = growthbook2.evalFeature("exp1");
    expect(result2.value).toBe("red");

    const expResult2 = growthbook2.triggerExperiment("manual-experiment")?.[0];
    expect(expResult2?.variationId).toBe(2);

    growthbook2.destroy();
    // console.log("cookie B", document.cookie);
    await sleep(100);

    // remove the fallbackAttribute "deviceId".
    // bucketing for "id" should have persisted in growthbook1 only
    const growthbook3 = new GrowthBook({
      apiHost: "https://fakeapi.sample.io",
      clientKey: "qwerty1234",
      stickyBucketService: new BrowserCookieStickyBucketService({
        jsCookie: Cookie,
      }),
      attributes: {
        id: "12345",
        foo: "bar",
        country: "USA",
      },
    });
    await growthbook3.loadFeatures();
    await sleep(10);

    const result3 = growthbook3.evalFeature("exp1");
    expect(result3.value).toBe("red");

    const expResult3 = growthbook3.triggerExperiment("manual-experiment")?.[0];
    expect(expResult3?.variationId).toBe(2);

    growthbook3.destroy();
    cleanup();
    // console.log("cookie C", document.cookie);

    document.cookie
      .split(";")
      .forEach(
        (cookie) =>
          (document.cookie =
            cookie + "=; expires=" + new Date(0).toUTCString()),
      );
    // console.log("cookie D", document.cookie);
  });

  it("reads, writes, and upgrades sticky buckets using ioredis driver", async () => {
    await clearCache();
    const [, cleanup] = mockApi(sdkPayload);
    const redis = new Redis();

    // with sticky bucket support
    const growthbook1 = new GrowthBook({
      apiHost: "https://fakeapi.sample.io",
      clientKey: "qwerty1234",
      stickyBucketService: new RedisStickyBucketService({
        redis,
      }),
      attributes: {
        deviceId: "d123",
        anonymousId: "ses123",
        foo: "bar",
        country: "USA",
      },
    });
    await growthbook1.loadFeatures();
    await sleep(10);

    // evaluate based on fallbackAttribute "deviceId"
    const result1 = growthbook1.evalFeature("exp1");
    expect(result1.value).toBe("red");

    const expResult1 = growthbook1.triggerExperiment("manual-experiment")?.[0];
    expect(expResult1?.variationId).toBe(2);

    growthbook1.destroy();
    await sleep(100);

    // provide the primary hashAttribute "id" as well as fallbackAttribute "deviceId"
    const growthbook2 = new GrowthBook({
      apiHost: "https://fakeapi.sample.io",
      clientKey: "qwerty1234",
      stickyBucketService: new RedisStickyBucketService({
        redis,
      }),
      attributes: {
        deviceId: "d123",
        anonymousId: "ses123",
        id: "12345",
        foo: "bar",
        country: "USA",
      },
    });
    await growthbook2.loadFeatures();
    await sleep(10);

    const result2 = growthbook2.evalFeature("exp1");
    expect(result2.value).toBe("red");

    const expResult2 = growthbook2.triggerExperiment("manual-experiment")?.[0];
    expect(expResult2?.variationId).toBe(2);

    growthbook2.destroy();
    await sleep(100);

    // remove the fallbackAttribute "deviceId".
    // bucketing for "id" should have persisted in growthbook1 only
    const growthbook3 = new GrowthBook({
      apiHost: "https://fakeapi.sample.io",
      clientKey: "qwerty1234",
      stickyBucketService: new RedisStickyBucketService({
        redis,
      }),
      attributes: {
        id: "12345",
        foo: "bar",
        country: "USA",
      },
    });
    await growthbook3.loadFeatures();
    await sleep(10);

    const result3 = growthbook3.evalFeature("exp1");
    expect(result3.value).toBe("red");

    const expResult3 = growthbook3.triggerExperiment("manual-experiment")?.[0];
    expect(expResult3?.variationId).toBe(2);

    growthbook3.destroy();
    cleanup();

    redis.flushall();
  });

  it("performs remote evaluation with remote-stored sticky buckets", async () => {
    await clearCache();
    remoteEvalRedis.flushall();
    const [, cleanup] = mockRemoteEvalApi(sdkPayload);

    // with sticky bucket support
    const growthbook1 = new GrowthBook({
      apiHost: "https://fakeapi.sample.io",
      clientKey: "qwerty1234",
      remoteEval: true,
      attributes: {
        deviceId: "d123",
        anonymousId: "ses123",
        foo: "bar",
        country: "USA",
      },
    });
    await growthbook1.loadFeatures();
    await sleep(10);

    // evaluate based on fallbackAttribute "deviceId"
    const result1 = growthbook1.evalFeature("exp1");
    expect(result1.value).toBe("red");

    growthbook1.destroy();
    await sleep(100);

    // provide the primary hashAttribute "id" as well as fallbackAttribute "deviceId"
    const growthbook2 = new GrowthBook({
      apiHost: "https://fakeapi.sample.io",
      clientKey: "qwerty1234",
      remoteEval: true,
      attributes: {
        deviceId: "d123",
        anonymousId: "ses123",
        id: "12345",
        foo: "bar",
        country: "USA",
      },
    });
    await growthbook2.loadFeatures();
    await sleep(10);

    const result2 = growthbook2.evalFeature("exp1");
    // console.log({result2})
    expect(result2.value).toBe("red");

    growthbook2.destroy();
    await sleep(100);

    // remove the fallbackAttribute "deviceId".
    // bucketing for "id" should have persisted in growthbook1 only
    const growthbook3 = new GrowthBook({
      apiHost: "https://fakeapi.sample.io",
      clientKey: "qwerty1234",
      remoteEval: true,
      attributes: {
        id: "12345",
        foo: "bar",
        country: "USA",
      },
    });
    await growthbook3.loadFeatures();
    await sleep(10);

    const result3 = growthbook3.evalFeature("exp1");
    expect(result3.value).toBe("red");

    growthbook3.destroy();
    cleanup();
    remoteEvalRedis.flushall();
  });

  it("resets sticky bucketing when the bucketVersion changes", async () => {
    await clearCache();

    const [, cleanup] = mockApi(sdkPayload, true);

    // SSE update will block variation 1 "red"
    const newPayload = {
      ...sdkPayload,
      features: {
        exp1: {
          ...sdkPayload?.features?.exp1,
          rules: [
            {
              key: "feature-exp",
              seed: "feature-exp",
              hashAttribute: "id",
              fallbackAttribute: "deviceId",
              hashVersion: 2,
              bucketVersion: 1, // <---------------- changed
              condition: { country: "USA" },
              variations: ["control", "red", "blue"],
              meta: [{ key: "0" }, { key: "1" }, { key: "2" }],
              coverage: 1,
              weights: [0.3334, 0.3333, 0.3333],
              phase: "0",
            },
          ],
        },
      },
    };
    const event = new MockEvent({
      url: "https://fakeapi.sample.io/sub/qwerty1234",
      setInterval: 200,
      responses: [
        {
          type: "features",
          data: JSON.stringify(newPayload),
        },
      ],
    });

    // evaluate based on fallbackAttribute "deviceId"
    const growthbook1 = new GrowthBook({
      apiHost: "https://fakeapi.sample.io",
      clientKey: "qwerty1234",
      stickyBucketService: new LocalStorageStickyBucketService(),
      attributes: {
        deviceId: "d123",
        foo: "bar",
        country: "USA",
      },
      subscribeToChanges: true,
    });

    await growthbook1.loadFeatures();
    await sleep(10);

    const result1 = growthbook1.evalFeature("exp1");
    expect(result1?.experimentResult?.stickyBucketUsed).toBe(false);
    await sleep(10);

    const result2 = growthbook1.evalFeature("exp1");
    expect(result2?.experimentResult?.stickyBucketUsed).toBe(true);
    await sleep(800);

    const result3 = growthbook1.evalFeature("exp1");
    expect(result3?.experimentResult?.stickyBucketUsed).toBe(false);

    growthbook1.destroy();
    cleanup();
    event.clear();

    localStorage.clear();
  });

  it("stops test enrollment when an existing sticky bucket is blocked by version", async () => {
    await clearCache();

    const [, cleanup] = mockApi(sdkPayload, true);

    // SSE update will increment the bucketVersion and block the previous versions
    const newPayload = {
      ...sdkPayload,
      features: {
        exp1: {
          ...sdkPayload?.features?.exp1,
          rules: [
            {
              key: "feature-exp",
              seed: "feature-exp",
              hashAttribute: "id",
              fallbackAttribute: "deviceId",
              hashVersion: 2,
              bucketVersion: 1, // <---------------- changed
              minBucketVersion: 1, // <---------------- changed
              condition: { country: "USA" },
              variations: ["control", "red", "blue"],
              meta: [{ key: "0" }, { key: "1" }, { key: "2" }],
              coverage: 1,
              weights: [0.3334, 0.3333, 0.3333],
              phase: "0",
            },
          ],
        },
      },
    };
    const event = new MockEvent({
      url: "https://fakeapi.sample.io/sub/qwerty1234",
      setInterval: 200,
      responses: [
        {
          type: "features",
          data: JSON.stringify(newPayload),
        },
      ],
    });

    // evaluate based on fallbackAttribute "deviceId"
    const growthbook1 = new GrowthBook({
      apiHost: "https://fakeapi.sample.io",
      clientKey: "qwerty1234",
      stickyBucketService: new LocalStorageStickyBucketService(),
      attributes: {
        deviceId: "d123",
        foo: "bar",
        country: "USA",
      },
      subscribeToChanges: true,
    });

    await growthbook1.loadFeatures();
    await sleep(10);

    const result1 = growthbook1.evalFeature("exp1");
    expect(result1.value).toBe("red");
    await sleep(800);

    const result2 = growthbook1.evalFeature("exp1");
    expect(result2.value).toBe("control");

    growthbook1.destroy();
    cleanup();
    event.clear();

    localStorage.clear();
  });

  it("disables sticky bucketing when disabled by experiment", async () => {
    await clearCache();

    const [, cleanup] = mockApi(sdkPayload, true);

    // SSE update will disable sticky bucketing
    const newPayload = {
      ...sdkPayload,
      features: {
        exp1: {
          ...sdkPayload?.features?.exp1,
          rules: [
            {
              key: "feature-exp",
              seed: "feature-exp",
              hashAttribute: "id",
              fallbackAttribute: "deviceId",
              hashVersion: 2,
              bucketVersion: 0,
              disableStickyBucketing: true, // <---------------- changed
              condition: { country: "USA" },
              variations: ["control", "red", "blue"],
              meta: [{ key: "0" }, { key: "1" }, { key: "2" }],
              coverage: 1,
              weights: [0.3334, 0.3333, 0.3333],
              phase: "0",
            },
          ],
        },
      },
    };
    const event = new MockEvent({
      url: "https://fakeapi.sample.io/sub/qwerty1234",
      setInterval: 200,
      responses: [
        {
          type: "features",
          data: JSON.stringify(newPayload),
        },
      ],
    });

    // evaluate based on fallbackAttribute "deviceId"
    const growthbook1 = new GrowthBook({
      apiHost: "https://fakeapi.sample.io",
      clientKey: "qwerty1234",
      stickyBucketService: new LocalStorageStickyBucketService(),
      attributes: {
        deviceId: "d123",
        foo: "bar",
        country: "USA",
      },
      subscribeToChanges: true,
    });
    await growthbook1.loadFeatures();
    await sleep(10);
    const result1 = growthbook1.evalFeature("exp1");
    expect(result1.value).toBe("red");

    growthbook1.destroy();

    const growthbook2 = new GrowthBook({
      apiHost: "https://fakeapi.sample.io",
      clientKey: "qwerty1234",
      stickyBucketService: new LocalStorageStickyBucketService(),
      attributes: {
        deviceId: "d123",
        foo: "bar",
        country: "USA",
        id: "12345",
      },
      subscribeToChanges: true,
    });
    await growthbook2.loadFeatures();
    await sleep(10);
    const result2 = growthbook2.evalFeature("exp1");
    expect(result2.value).toBe("red");

    growthbook2.destroy();

    const growthbook3 = new GrowthBook({
      apiHost: "https://fakeapi.sample.io",
      clientKey: "qwerty1234",
      stickyBucketService: new LocalStorageStickyBucketService(),
      attributes: {
        foo: "bar",
        country: "USA",
        id: "12345",
      },
      subscribeToChanges: true,
    });
    await growthbook3.loadFeatures();
    await sleep(10);
    const result3 = growthbook3.evalFeature("exp1");
    expect(result3.value).toBe("red");

    await sleep(800);

    const result4 = growthbook3.evalFeature("exp1");
    // no more sticky bucketing, new hash attribute (id) should evaluate to "blue"
    expect(result4.value).toBe("blue");

    growthbook3.destroy();
    cleanup();
    event.clear();

    localStorage.clear();
  });

  describe("getKey", () => {
    it("returns the correct key", async () => {
      const sbs = new LocalStorageStickyBucketService();
      expect(sbs.getKey("foo", "bar")).toBe("gbStickyBuckets__foo||bar");
    });

    it("returns the correct key when a prefix is provided", async () => {
      const sbs = new LocalStorageStickyBucketService({ prefix: "test_" });
      expect(sbs.getKey("foo", "bar")).toBe("test_foo||bar");
    });
  });
});
