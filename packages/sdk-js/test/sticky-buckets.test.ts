import cloneDeep from "lodash/cloneDeep";
import {
  configureCache,
  GrowthBook,
  clearCache,
  setPolyfills,
  FeatureApiResponse,
  LocalStorageStickyBucketService,
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
  // eslint-disable-next-line
  const f = jest.fn((url: string, resp: any) => {
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

const sdkPayload = {
  features: {
    exp1: {
      defaultValue: "control",
      rules: [
        {
          coverage: 1,
          seed: "feature-exp",
          hashAttribute: "id",
          fallbackAttribute: "deviceId",
          hashVersion: 2,
          stickyBucketing: true,
          bucketVersion: 1,
          variations: ["control", "red", "blue"],
          weights: [0.3334, 0.3333, 0.3333],
          key: "feature-exp",
          phase: "0",
        },
      ],
    },
  },
};

describe("sticky-buckets", () => {
  it("applies a simple sticky bucket using localstorage driver", async () => {
    await clearCache();
    const [, cleanup] = mockApi(sdkPayload);

    // with sticky bucket support
    const growthbook1a = new GrowthBook({
      apiHost: "https://fakeapi.sample.io",
      clientKey: "qwerty1234",
      stickyBucketService: new LocalStorageStickyBucketService(),
      attributes: {
        deviceId: "d123",
        foo: "bar",
      },
    });

    // no sticky bucket support
    const growthbook2a = new GrowthBook({
      apiHost: "https://fakeapi.sample.io",
      clientKey: "qwerty1234",
      attributes: {
        deviceId: "d123",
        foo: "bar",
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
    expect(result2.value).toBe("red");

    growthbook1a.destroy();
    growthbook2a.destroy();
    console.log("localStorage A\n==============", localStorage);
    await sleep(100);

    // provide the primary hashAttribute "id" as well as fallbackAttribute "deviceId"
    const growthbook1b = new GrowthBook({
      apiHost: "https://fakeapi.sample.io",
      clientKey: "qwerty1234",
      stickyBucketService: new LocalStorageStickyBucketService(),
      attributes: {
        deviceId: "d123",
        id: "12345",
        foo: "bar",
      },
    });
    const growthbook2b = new GrowthBook({
      apiHost: "https://fakeapi.sample.io",
      clientKey: "qwerty1234",
      attributes: {
        deviceId: "d123",
        id: "12345",
        foo: "bar",
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

    growthbook1b.destroy();
    growthbook2b.destroy();
    console.log("localStorage B\n==============", localStorage);
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
      },
    });
    const growthbook2c = new GrowthBook({
      apiHost: "https://fakeapi.sample.io",
      clientKey: "qwerty1234",
      attributes: {
        id: "12345",
        foo: "bar",
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

    growthbook1c.destroy();
    growthbook2c.destroy();
    cleanup();
    console.log("localStorage C\n==============", localStorage);

    localStorage.clear();
  });
});
