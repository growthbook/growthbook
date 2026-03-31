import {
  ExperimentInterface,
  ExperimentPhase,
  Variation,
  VariationStatus,
} from "shared/types/experiment";

type ExperimentWithVariations = Pick<ExperimentInterface, "variations">;

type ExperimentWithVariationsAndPhases = ExperimentWithVariations & {
  phases: Pick<ExperimentPhase, "variations">[];
};

type VariationWithIndex = Variation & {
  index: number;
};

type VariationWithIndexAndStatus = Variation & {
  status: VariationStatus;
  index: number;
};

/**
 * Returns the variations for the current/latest phase of an experiment.
 * Today this just returns experiment.variations directly. In the future,
 * this will merge phase-level variation status with top-level metadata.
 */
export function getLatestPhaseVariations(
  experiment: ExperimentWithVariationsAndPhases,
): VariationWithIndexAndStatus[] {
  const allVariations = getAllVariations(experiment);
  const defaultResponse = allVariations.map((v, i) => ({
    ...v,
    index: i,
    status: "active" as const,
  }));

  const latestPhase = experiment.phases?.[experiment.phases.length - 1];

  // safe guard in case phase or variations are missing
  if (!latestPhase || !latestPhase.variations) {
    return defaultResponse;
  }

  let hasMissing = false;
  const foundVariations: VariationWithIndexAndStatus[] = [];
  latestPhase.variations.forEach((v) => {
    const foundVariation = allVariations.find((allV) => allV.id === v.id);
    if (foundVariation === undefined) {
      hasMissing = true;
      return;
    }
    foundVariations.push({
      ...foundVariation,
      // Add status from phase variation, if present
      status: v.status,
    });
  });
  // If any missing, fall back to all variations with status "active"
  if (hasMissing) {
    return defaultResponse;
  }

  return foundVariations;
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
