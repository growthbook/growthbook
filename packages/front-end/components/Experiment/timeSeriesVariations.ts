import type { MetricTimeSeriesVariation } from "shared/validators";
import type { GraphVariation } from "./ExperimentDateGraph";

export function getTimeSeriesGraphVariations(
  variations: GraphVariation[],
): GraphVariation[] {
  return variations.map((variation) => ({
    name: variation.name,
    index: variation.index,
    experimentVariationId: variation.experimentVariationId,
  }));
}

export function findTimeSeriesVariation(
  storedVariations: MetricTimeSeriesVariation[],
  graphVariation: GraphVariation,
): MetricTimeSeriesVariation | undefined {
  if (graphVariation.experimentVariationId !== undefined) {
    return storedVariations.find(
      (variation) => variation.id === graphVariation.experimentVariationId,
    );
  }
  return storedVariations.find(
    (variation) => variation.name === graphVariation.name,
  );
}
