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
  SavedGroupsValues,
  StickyAssignmentsDocument,
  StickyAttributeKey,
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
} from "../src/util";
import cases from "./cases.json";

type Cases = {
  specVersion: string;
  // value, hash
  hash: [string, string, number, number][];
  // name, context, experiment, value, inExperiment
  run: [string, Context, Experiment<any>, any, boolean, boolean][];
  // name, context, feature key, result
  feature: [string, Context, string, FeatureResult][];
  // name, condition, attribute, result
  evalCondition: [string, any, any, boolean, SavedGroupsValues][];
  // name, args ([numVariations, coverage, weights]), result
  getBucketRange: [
    string,
    [number, number, number[] | null],
    VariationRange[],
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
    StickyAssignmentsDocument[],
    string,
    Result<any>,
    Record<StickyAttributeKey, StickyAssignmentsDocument>,
  ][];
  // name, context, result
  urlRedirect: [
    string,
    Context,
    { inExperiment: boolean; urlRedirect: any; urlWithParams: string }[],
  ][];
};

const round = (n: number) => Math.floor(n * 1e8) / 1e8;
const roundArray = (arr: number[]) => arr.map((n) => round(n));
const roundArrayArray = (arr: number[][]) => arr.map((a) => roundArray(a));

function sleep(ms = 20) {
  return new Promise((res) => setTimeout(res, ms));
}

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
      expect(growthbook.evalFeature(key)).toEqual(expected);
      growthbook.destroy();
    },
  );

  it.each((cases as Cases).evalCondition)(
    "evalCondition[%#] %s",
    (name, condition, value, expected, savedGroups = {}) => {
      const consoleErrorMock = jest
        .spyOn(console, "error")
        .mockImplementation();
      expect(evalCondition(value, condition, savedGroups)).toEqual(expected);
      consoleErrorMock.mockRestore();
    },
  );

  it.each((cases as Cases).hash)(
    "hash[%#] hash(`%s`, `%s`, %s)",
    (seed, value, version, expected) => {
      expect(hash(seed, value, version)).toEqual(expected);
    },
  );

  it.each((cases as Cases).getBucketRange)(
    "getBucketRange[%#] %s",
    (name, inputs, expected) => {
      const consoleErrorMock = jest
        .spyOn(console, "error")
        .mockImplementation();

      expect(
        roundArrayArray(
          getBucketRanges(inputs[0], inputs[1], inputs[2] ?? undefined),
        ),
      ).toEqual(roundArrayArray(expected));

      consoleErrorMock.mockRestore();
    },
  );

  it.each((cases as Cases).chooseVariation)(
    "chooseVariation[%#] %s",
    (name, n, ranges, expected) => {
      expect(chooseVariation(n, ranges)).toEqual(expected);
    },
  );

  it.each((cases as Cases).getQueryStringOverride)(
    "getQueryStringOverride[%#] %s",
    (name, key, url, numVariations, expected) => {
      expect(getQueryStringOverride(key, url, numVariations)).toEqual(expected);
    },
  );

  it.each((cases as Cases).inNamespace)(
    "inNamespace[%#] %s",
    (name, id, namespace, expected) => {
      expect(inNamespace(id, namespace)).toEqual(expected);
    },
  );

  it.each((cases as Cases).getEqualWeights)(
    "getEqualWeights[%#] %d",
    (n, expected) => {
      expect(roundArray(getEqualWeights(n))).toEqual(roundArray(expected));
    },
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
    },
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
    },
  );

  it.each((cases as Cases).stickyBucket)(
    "stickyBucket[%#] %s",
    async (
      name,
      ctx,
      stickyBucketAssignmentDocs,
      key,
      expectedExperimentResult,
      expectedStickyBucketAssignmentDocs,
    ) => {
      localStorage.clear();
      await clearCache();

      const sbs = new LocalStorageStickyBucketService();
      // seed the sticky bucket repo
      for (const doc of stickyBucketAssignmentDocs) {
        await sbs.saveAssignments(doc);
      }

      ctx = {
        ...ctx,
        stickyBucketService: sbs,
      };
      const growthbook = new GrowthBook(ctx);
      // arbitrary sleep to let SB docs hydrate
      await sleep(10);
      expect(growthbook.evalFeature(key).experimentResult ?? null).toEqual(
        expectedExperimentResult,
      );
      expect(growthbook.getStickyBucketAssignmentDocs()).toEqual(
        expectedStickyBucketAssignmentDocs,
      );
      growthbook.destroy();
    },
  );

  it.each((cases as Cases).urlRedirect)(
    "urlRedirect[%#] %s",
    async (name, ctx, result) => {
      const growthbook = new GrowthBook(ctx);
      await sleep();
      const trackingCalls = growthbook.getDeferredTrackingCalls();
      const actualResult: {
        inExperiment: boolean;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        urlRedirect: any;
        urlWithParams: string;
      }[] = trackingCalls.map((c) => ({
        inExperiment: c.result.inExperiment,
        urlRedirect: c.result.value.urlRedirect,
        urlWithParams: growthbook.getRedirectUrl(),
      }));
      expect(actualResult).toEqual(result);
      growthbook.destroy();
    },
  );
});
