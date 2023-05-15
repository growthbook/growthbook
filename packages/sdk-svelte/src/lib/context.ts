import type { GrowthBook } from "@growthbook/growthbook";

export interface GrowthBookContext {
  growthbook?: GrowthBook;
}

export const ContextSymbol = Symbol("GrowthBookContext");
