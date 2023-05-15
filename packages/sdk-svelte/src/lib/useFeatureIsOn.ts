import { useGrowthBook } from "./useGrowthBook";

/* eslint-disable @typescript-eslint/no-explicit-any */
export function useFeatureIsOn<
  AppFeatures extends Record<string, any> = Record<string, any>
>(id: string & keyof AppFeatures): boolean {
  const growthbook = useGrowthBook<AppFeatures>();
  return growthbook ? growthbook.isOn(id) : false;
}
