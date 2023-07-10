import type { GrowthBook } from "@growthbook/growthbook";
import type { Writable } from "svelte/store";

export interface GrowthBookContext {
  growthbookClient: Writable<GrowthBook | undefined>;
}

export const ContextSymbol = Symbol("GrowthBookContext");
