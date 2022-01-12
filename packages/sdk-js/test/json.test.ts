/* eslint-disable @typescript-eslint/no-explicit-any */

import { Context, FeatureResult, GrowthBook } from "../src";
import { evalCondition } from "../src/mongrule";
import features from "./cases/features.json";
import conditions from "./cases/conditions.json";

type FeatureCasesArray = [string, Context, string, Partial<FeatureResult>][];

// 5th optional array element specifies if a debug error is expected or not
type ConditionCasesArray =
  | [string, boolean, any, any]
  | [string, boolean, any, any, boolean];

describe("json test suite", () => {
  it.each(features as FeatureCasesArray)(
    "features.json[%#] %s",
    (name, ctx, key, result) => {
      const growthbook = new GrowthBook(ctx);
      const res = growthbook.feature(key);

      expect(res).toEqual({
        on: !!result.value,
        off: !result.value,
        ...result,
      });

      growthbook.destroy();
    }
  );

  it.each(conditions as ConditionCasesArray)(
    "conditions.json[%#] %s",
    (name, expected, condition, value, expectError = false) => {
      const consoleErrorMock = jest
        .spyOn(console, "error")
        .mockImplementation();
      expect(evalCondition(value, condition)).toEqual(expected);
      expect(consoleErrorMock).toHaveBeenCalledTimes(expectError ? 1 : 0);
      consoleErrorMock.mockRestore();
    }
  );
});
