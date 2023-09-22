import cloneDeep from "lodash/cloneDeep";
import {
  configureCache,
  GrowthBook,
  clearCache,
  setPolyfills,
  FeatureApiResponse,
} from "../src";
import { evaluateFeatures } from "./helpers/evaluateFeatures";

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
                  })
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

  return [f, () => setPolyfills({ fetch: undefined })] as const;
}

const sdkPayload = {
  features: {
    foo: {
      defaultValue: "initial",
      rules: [
        {
          condition: {
            uid: { $in: ["3", "5", "10"] },
          },
          force: "ruleEvaluated",
        },
      ],
    },
    bar: {
      defaultValue: "initial",
    },
    exp1: {
      defaultValue: {},
      rules: [
        {
          coverage: 1,
          seed: "exp1",
          hashAttribute: "uid",
          hashVersion: 2,
          variations: [{ v: "controlValue" }, { v: "variationValue" }],
          weights: [0.5, 0.5],
          key: "exp1",
          phase: "0",
        },
      ],
    },
  },
};

describe("remote-eval", () => {
  it("debounces network requests for same clientKey and userId", async () => {
    await clearCache();
    const [f, cleanup] = mockApi(sdkPayload);

    const growthbook1 = new GrowthBook({
      apiHost: "https://fakeapi.sample.io",
      clientKey: "qwerty1234",
      remoteEval: true,
      userId: "1",
    });

    const growthbook2 = new GrowthBook({
      apiHost: "https://fakeapi.sample.io",
      clientKey: "qwerty1234",
      remoteEval: true,
      userId: "1",
    });

    const growthbook3 = new GrowthBook({
      apiHost: "https://fakeapi.sample.io",
      clientKey: "qwerty1234",
      remoteEval: true,
      userId: "2",
    });

    const growthbook4 = new GrowthBook({
      apiHost: "https://fakeapi.sample.io",
      clientKey: "asdfjkl",
      remoteEval: true,
      userId: "1",
    });

    await Promise.all([
      growthbook1.loadFeatures(),
      growthbook2.loadFeatures(),
      growthbook3.loadFeatures(),
      growthbook4.loadFeatures(),
    ]);

    expect(f.mock.calls.length).toEqual(3);

    growthbook1.destroy();
    growthbook2.destroy();
    growthbook3.destroy();
    growthbook4.destroy();
    cleanup();
  });

  it("doesn't fire network requests before loadFeatures is called", async () => {
    await clearCache();
    const [f, cleanup] = mockApi(sdkPayload);

    const growthbook = new GrowthBook({
      apiHost: "https://fakeapi.sample.io",
      clientKey: "qwerty1234",
      remoteEval: true,
      userId: "17tfs168gd",
    });

    expect(f.mock.calls.length).toEqual(0);

    growthbook.setAttributes({ uid: "5" });
    await sleep(10);
    expect(f.mock.calls.length).toEqual(0);

    growthbook.setForcedFeatures(new Map([["bar", "something else"]]));
    await sleep(10);
    expect(f.mock.calls.length).toEqual(0);

    growthbook.setForcedVariations({ exp1: 0 });
    await sleep(10);
    expect(f.mock.calls.length).toEqual(0);

    growthbook.setURL("https://www.page.io/page2");
    await sleep(10);
    expect(f.mock.calls.length).toEqual(0);

    await growthbook.loadFeatures();
    expect(f.mock.calls.length).toEqual(1);

    growthbook.destroy();
    cleanup();
  });

  it("fires a network request each time a remote eval dependency changes", async () => {
    await clearCache();
    const [f, cleanup] = mockApi(sdkPayload);

    const growthbook = new GrowthBook({
      apiHost: "https://fakeapi.sample.io",
      clientKey: "qwerty1234",
      remoteEval: true,
      userId: "17tfs168gd",
    });

    // 1
    await growthbook.loadFeatures();
    await sleep(100);

    // 2
    growthbook.setAttributes({ uid: "5" });
    await sleep(100);

    // setForcedFeatures should NOT trigger an API call
    growthbook.setForcedFeatures(new Map([["bar", "something else"]]));
    await sleep(100);

    // 3
    growthbook.setForcedVariations({ exp1: 0 });
    await sleep(100);

    // 4
    growthbook.setURL("https://www.page.io/page2");
    await sleep(100);

    expect(f.mock.calls.length).toEqual(4);

    growthbook.destroy();
    cleanup();
    await clearCache();
  });

  it("updates features when remote eval dependencies change", async () => {
    await clearCache();

    const [f, cleanup] = mockApi(sdkPayload);

    const growthbook = new GrowthBook({
      apiHost: "https://fakeapi.sample.io",
      clientKey: "qwerty1234",
      remoteEval: true,
      userId: "17tfs168gd",
    });

    await growthbook.loadFeatures();

    expect(f.mock.calls.length).toEqual(1);

    expect(growthbook.evalFeature("foo").value).toEqual("initial");
    expect(growthbook.evalFeature("bar").value).toEqual("initial");

    growthbook.setAttributes({ uid: "5" });
    await sleep(100);
    expect(growthbook.evalFeature("foo").value).toEqual("ruleEvaluated");
    expect(growthbook.evalFeature("bar").value).toEqual("initial");

    growthbook.setForcedFeatures(new Map([["bar", "something else"]]));
    await sleep(100);
    expect(growthbook.evalFeature("bar").value).toEqual("something else");

    expect(growthbook.evalFeature("exp1").value.v).toEqual("variationValue");
    growthbook.setForcedVariations({ exp1: 0 });
    await sleep(100);
    expect(growthbook.evalFeature("exp1").value.v).toEqual("controlValue");
    growthbook.forceVariation("exp1", 1);
    await sleep(100);
    expect(growthbook.evalFeature("exp1").value.v).toEqual("variationValue");

    growthbook.destroy();
    cleanup();
    await clearCache();
  });
});
