/* eslint-disable @typescript-eslint/no-explicit-any */

import { Context, Experiment, FeatureResult, GrowthBook } from "../src";
import { evalCondition } from "../src/mongrule";
import { hashFnv32a } from "../src/util";
import features from "./cases/features.json";
import conditions from "./cases/conditions.json";
import fnv from "./cases/fnv.json";
import experiments from "./cases/experiments.json";

// Name, context, feature key, result
type FeatureCasesArray = [string, Context, string, FeatureResult][];
// Name, result, condition, attributes
type ConditionCasesArray = [string, any, any, boolean];
// Value, result
type FnvCasesArray = [string, number];
// Name, context, experiment, result.value, result.inExperiment
type ExperimentsCasesArray = [string, Context, Experiment<any>, any, boolean];

describe("json test suite", () => {
  it.each(features as FeatureCasesArray)(
    "features.json[%#] %s",
    (name, ctx, key, result) => {
      const growthbook = new GrowthBook(ctx);
      expect(growthbook.feature(key)).toEqual(result);
      growthbook.destroy();
    }
  );

  it.each(conditions as ConditionCasesArray)(
    "conditions.json[%#] %s",
    (name, condition, value, expected) => {
      const consoleErrorMock = jest
        .spyOn(console, "error")
        .mockImplementation();
      expect(evalCondition(value, condition)).toEqual(expected);
      consoleErrorMock.mockRestore();
    }
  );

  it.each((fnv as unknown) as FnvCasesArray)(
    "fnv.json[%#] %s",
    (value, expected) => {
      expect(hashFnv32a(value as string) % 1000).toEqual(expected);
    }
  );

  it.each(experiments as ExperimentsCasesArray)(
    "experiments.json[%#] %s",
    (name, ctx, exp, value, inExperiment) => {
      const growthbook = new GrowthBook(ctx);
      const res = growthbook.run(exp);
      expect(res.value).toEqual(value);
      expect(res.inExperiment).toEqual(inExperiment);
      growthbook.destroy();
    }
  );
});
