/* eslint-disable @typescript-eslint/no-explicit-any */
import type { FeatureResult, JSONValue } from "@growthbook/growthbook";
import { useGrowthBook } from "./useGrowthBook";

export function useFeature<T extends JSONValue = any>(
  id: string
): FeatureResult<T | null> {
  const growthbook = useGrowthBook();

  if (!growthbook) {
    return {
      value: null,
      on: false,
      off: true,
      source: "unknownFeature",
      ruleId: "",
    };
  }

  return growthbook.evalFeature<T>(id);
}
