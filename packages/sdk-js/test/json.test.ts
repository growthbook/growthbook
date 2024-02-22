/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  clearCache,
  Context,
  Experiment,
  FeatureResult,
  GrowthBook,
  LocalStorageStickyBucketService,
  Result,
} from "../src";
import { evalCondition } from "../src/mongrule";
import {
  StickyAssignmentsDocument,
  StickyAttributeKey,
  TrackingData,
  VariationRange,
} from "../src/types/growthbook";
import {
  chooseVariation,
  decrypt,
  getBucketRanges,
  getEqualWeights,
  getQueryStringOverride,
  hash,
  inNamespace,
  paddedVersionString,
} from "../src/util";
import cases from "./cases.json";

type Cases = {
  specVersion: string;
  // value, hash
  hash: [string, string, number, number][];
  // name, context, experiment, value, inExperiment
  run: [string, Context, Experiment<any>, any, boolean, boolean][];
  // name, context, feature key, result
  feature: [string, Context, string, Omit<FeatureResult, "ruleId">][];
  // name, condition, attribute, result
  evalCondition: [string, any, any, boolean][];
  // name, args ([numVariations, coverage, weights]), result
  getBucketRange: [
    string,
    [number, number, number[] | null],
    VariationRange[]
  ][];
  // name, hash, ranges, result
  chooseVariation: [string, number, VariationRange[], number][];
  // name, experiment key, url, numVariations, result
  getQueryStringOverride: [string, string, string, number, number | null][];
  // name, id, namespace, result
  inNamespace: [string, string, [string, number, number], boolean][];
  // numVariations, result
  getEqualWeights: [number, number[]][];
  // name, encryptedString, key, result
  decrypt: [string, string, string, string | null][];
  // name, context, feature key, result
  stickyBucket: [
    string,
    Context,
    string,
    Result<any>,
    Record<StickyAttributeKey, StickyAssignmentsDocument>
  ][];
  versionCompare: {
    // version, version, meets condition
    lt: [string, string, boolean][];
    gt: [string, string, boolean][];
    eq: [string, string, boolean][];
  };
  // name, context, result
  urlRedirect: [string, Context, TrackingData[]][];
};

const round = (n: number) => Math.floor(n * 1e8) / 1e8;
const roundArray = (arr: number[]) => arr.map((n) => round(n));
const roundArrayArray = (arr: number[][]) => arr.map((a) => roundArray(a));

/* eslint-disable */
const { webcrypto } = require("node:crypto");
import { TextEncoder, TextDecoder } from "util";
global.TextEncoder = TextEncoder;
(global as any).TextDecoder = TextDecoder;
/* eslint-enable */

describe("json test suite", () => {
  it.each((cases as Cases).feature)(
    "feature[%#] %s",
    (name, ctx, key, expected) => {
      const growthbook = new GrowthBook(ctx);
      expect(growthbook.feature(key)).toEqual({
        ruleId: "",
        ...expected,
      });
      growthbook.destroy();
    }
  );

  it.each((cases as Cases).evalCondition)(
    "evalCondition[%#] %s",
    (name, condition, value, expected) => {
      const consoleErrorMock = jest
        .spyOn(console, "error")
        .mockImplementation();
      expect(evalCondition(value, condition)).toEqual(expected);
      consoleErrorMock.mockRestore();
    }
  );

  it.each((cases as Cases).hash)(
    "hash[%#] hash(`%s`, `%s`, %s)",
    (seed, value, version, expected) => {
      expect(hash(seed, value, version)).toEqual(expected);
    }
  );

  it.each((cases as Cases).getBucketRange)(
    "getBucketRange[%#] %s",
    (name, inputs, expected) => {
      const consoleErrorMock = jest
        .spyOn(console, "error")
        .mockImplementation();

      expect(
        roundArrayArray(
          getBucketRanges(inputs[0], inputs[1], inputs[2] ?? undefined)
        )
      ).toEqual(roundArrayArray(expected));

      consoleErrorMock.mockRestore();
    }
  );

  it.each((cases as Cases).chooseVariation)(
    "chooseVariation[%#] %s",
    (name, n, ranges, expected) => {
      expect(chooseVariation(n, ranges)).toEqual(expected);
    }
  );

  it.each((cases as Cases).getQueryStringOverride)(
    "getQueryStringOverride[%#] %s",
    (name, key, url, numVariations, expected) => {
      expect(getQueryStringOverride(key, url, numVariations)).toEqual(expected);
    }
  );

  it.each((cases as Cases).inNamespace)(
    "inNamespace[%#] %s",
    (name, id, namespace, expected) => {
      expect(inNamespace(id, namespace)).toEqual(expected);
    }
  );

  it.each((cases as Cases).getEqualWeights)(
    "getEqualWeights[%#] %d",
    (n, expected) => {
      expect(roundArray(getEqualWeights(n))).toEqual(roundArray(expected));
    }
  );

  it.each((cases as Cases).run)(
    "run[%#] %s",
    (name, ctx, exp, value, inExperiment, hashUsed) => {
      const growthbook = new GrowthBook(ctx);
      const res = growthbook.run(exp);
      expect(res.value).toEqual(value);
      expect(res.inExperiment).toEqual(inExperiment);
      expect(res.hashUsed).toEqual(hashUsed);
      growthbook.destroy();
    }
  );

  it.each((cases as Cases).decrypt)(
    "decrypt[%#] %s",
    async (name, encryptedString, key, expected) => {
      let result: string | null = null;

      try {
        result = await decrypt(encryptedString, key, webcrypto.subtle);
      } catch (e) {
        // If we were expecting an actual value, that's a bug
        if (expected) {
          throw e;
        }
      }
      expect(result).toEqual(expected);
    }
  );

  it.each((cases as Cases).stickyBucket)(
    "stickyBucket[%#] %s",
    async (
      name,
      ctx,
      key,
      expectedExperimentResult,
      expectedStickyBucketAssignmentDocs
    ) => {
      await clearCache();
      ctx = {
        ...ctx,
        stickyBucketService: new LocalStorageStickyBucketService(),
      };
      const growthbook = new GrowthBook(ctx);
      expect(growthbook.evalFeature(key).experimentResult ?? null).toEqual(
        expectedExperimentResult
      );
      expect(growthbook.getStickyBucketAssignmentDocs()).toEqual(
        expectedStickyBucketAssignmentDocs
      );
      growthbook.destroy();
      localStorage.clear();
    }
  );

  describe("version strings", () => {
    describe("equality", () => {
      it.each((cases as Cases).versionCompare.eq)(
        "versionCompare.eq[%#] %s === %s",
        (version, otherVersion, expected) => {
          expect(
            paddedVersionString(version) === paddedVersionString(otherVersion)
          ).toBe(expected);
          expect(
            paddedVersionString(version) !== paddedVersionString(otherVersion)
          ).toBe(!expected);
          expect(
            paddedVersionString(version) >= paddedVersionString(otherVersion)
          ).toBe(expected);
          expect(
            paddedVersionString(version) <= paddedVersionString(otherVersion)
          ).toBe(expected);
        }
      );
    });

    describe("comparisons", () => {
      it.each((cases as Cases).versionCompare.gt)(
        "versionCompare.gt[%#] %s > %s",
        (version, otherVersion, expected) => {
          expect(
            paddedVersionString(version) >= paddedVersionString(otherVersion)
          ).toBe(expected);
          expect(
            paddedVersionString(version) > paddedVersionString(otherVersion)
          ).toBe(expected);
        }
      );

      it.each((cases as Cases).versionCompare.lt)(
        "versionCompare.lt[%#] %s < %s",
        (version, otherVersion, expected) => {
          expect(
            paddedVersionString(version) < paddedVersionString(otherVersion)
          ).toBe(expected);
          expect(
            paddedVersionString(version) <= paddedVersionString(otherVersion)
          ).toBe(expected);
        }
      );
    });
  });

  it.each((cases as Cases).urlRedirect)(
    "urlRedirect[%#] %s",
    (name, ctx, result) => {
      const growthbook = new GrowthBook(ctx);
      const data = growthbook.getDeferredTrackingCalls();
      const calls: TrackingData[] = JSON.parse(atob(data));
      const actualResult = calls.map((c) => ({
        inExperiment: c.result.inExperiment,
        urlRedirect: c.result.value.urlRedirect,
      }));
      expect(actualResult).toEqual(result);
      growthbook.destroy();
    }
  );
});
