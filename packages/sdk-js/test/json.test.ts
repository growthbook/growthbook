/* eslint-disable @typescript-eslint/no-explicit-any */

import { Context, Experiment, FeatureResult, GrowthBook } from "../src";
import { evalCondition } from "../src/mongrule";
import { VariationRange } from "../src/types/growthbook";
import {
  chooseVariation,
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
  hash: [string, number][];
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
};

const round = (n: number) => Math.floor(n * 1e8) / 1e8;
const roundArray = (arr: number[]) => arr.map((n) => round(n));
const roundArrayArray = (arr: number[][]) => arr.map((a) => roundArray(a));

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

  it.each((cases as Cases).hash)("hash[%#] %s", (value, expected) => {
    expect(hash(value as string)).toEqual(expected);
  });

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
});
