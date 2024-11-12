/* eslint-disable @typescript-eslint/no-explicit-any */
import type { JSONValue, WidenPrimitives } from "@growthbook/growthbook";
import { useGrowthBook } from "./useGrowthBook";

export function useFeatureValue<T extends JSONValue = any>(
  id: string,
  fallback: T
): WidenPrimitives<T> {
  const growthbook = useGrowthBook();
  return growthbook
    ? growthbook.getFeatureValue(id, fallback)
    : (fallback as WidenPrimitives<T>);
}
