import { Variation } from "shared/types/experiment";

type ExperimentWithVariations = {
  variations: Variation[];
};

type VariationWithIndex = Variation & {
  index: number;
};

/**
 * Returns the variations for the current/latest phase of an experiment.
 * Today this just returns experiment.variations directly. In the future,
 * this will merge phase-level variation status with top-level metadata.
 */
export function getLatestPhaseVariations(
  experiment: ExperimentWithVariations,
): VariationWithIndex[] {
  const allVariations = getAllVariations(experiment);

  // TODO change to come from phase
  const phaseVariations = experiment.variations;

  const indexById = new Map<string, number>();
  allVariations.forEach((v, i) => {
    indexById.set(v.id, i);
  });

  let hasMissing = false;
  const result: VariationWithIndex[] = phaseVariations.map((v, i) => {
    const foundIndex = indexById.get(v.id);
    if (foundIndex === undefined) {
      hasMissing = true;
      return {
        ...v,
        index: i,
      };
    }
    return {
      ...allVariations[foundIndex],
      // override experiment variation metadata with phase variation metadata, if present
      ...v,
      index: foundIndex,
    };
  });
  if (!hasMissing) {
    return result;
  }

  // Otherwise, return all variations with the index as the position in the array
  return result.map((v, i) => ({
    ...v,
    index: i,
  }));
}

/**
 * Returns all variations defined on an experiment, regardless of phase.
 * Use this when you need to look up a variation by index or ID outside
 * the scope of a specific phase (e.g. winner, releasedVariationId).
 * Sometimes we do look up via index within a phase, such as around results
 * computation from the stats engine, and in those cases, please use
 * getLatestPhaseVariations.
 */
export function getAllVariations(
  experiment: ExperimentWithVariations,
): VariationWithIndex[] {
  return experiment.variations.map((v, i) => ({
    ...v,
    index: i,
  }));
}
