/* eslint-disable @typescript-eslint/no-explicit-any */
import type { GrowthBook } from "@growthbook/growthbook";
import { getContext } from "svelte";
import { get } from "svelte/store";
import { ContextSymbol } from "./context";
import type { GrowthBookContext } from "./context";

export function useGrowthBook<
  AppFeatures extends Record<string, any> = Record<string, any>
>(): GrowthBook<AppFeatures> | undefined {
  const { growthbookClient } = getContext<GrowthBookContext>(ContextSymbol);

  return get(growthbookClient);
}
