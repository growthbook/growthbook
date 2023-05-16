import type { Experiment, Result } from "@growthbook/growthbook";
import { useGrowthBook } from "./useGrowthBook";

export function useExperiment<T>(experiment: Experiment<T>): Result<T> {
  const growthbook = useGrowthBook();
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
