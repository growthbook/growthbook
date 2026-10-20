import type { ExperimentReportVariation } from "shared/types/report";
import type { MetricTimeSeriesVariation } from "shared/validators";

export type TimeSeriesGraphVariation = Pick<
  ExperimentReportVariation,
  "name" | "index" | "experimentVariationId"
>;

export function getTimeSeriesGraphVariations(
  variations: TimeSeriesGraphVariation[],
): TimeSeriesGraphVariation[] {
  return variations.map((variation) => ({
    name: variation.name,
    index: variation.index,
    experimentVariationId: variation.experimentVariationId,
  }));
}

export function findTimeSeriesVariation(
  storedVariations: MetricTimeSeriesVariation[],
  graphVariation: TimeSeriesGraphVariation,
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
