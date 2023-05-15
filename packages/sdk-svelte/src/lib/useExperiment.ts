import type { Experiment, Result } from "@growthbook/growthbook";
import { getContext } from "svelte";
import type { GrowthBookContext } from "./context";
import { ContextSymbol } from "./context";

export function useExperiment<T>(experiment: Experiment<T>): Result<T> {
  const { growthbook } = getContext<GrowthBookContext>(ContextSymbol);
  if (!growthbook) {
    return {
      featureId: null,
      value: experiment.variations[0],
      variationId: 0,
      inExperiment: false,
      hashUsed: false,
      hashAttribute: experiment.hashAttribute || "id",
      hashValue: "",
      key: "",
    };
  }

  return growthbook.run(experiment);
}
