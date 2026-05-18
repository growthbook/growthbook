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

  // safe guard in case phase or variations are missing or are an empty array
  if (
    !latestPhase ||
    !latestPhase.variations ||
    latestPhase.variations.length === 0
  ) {
    return defaultResponse;
  }

  let hasMissing = false;
  const foundVariations: VariationWithIndexAndStatus[] = [];
  for (const v of latestPhase.variations) {
    const foundVariation = allVariations.find((allV) => allV.id === v.id);
    if (foundVariation === undefined) {
      hasMissing = true;
      break;
    }
    foundVariations.push({
      ...foundVariation,
      // Add status from phase variation, if present
      status: v.status,
    });
  }
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

/**
 * Returns the indexes of variations that are disabled (passThrough) in the
 * latest phase. These are the indexes consumers should hide from the results
 * table variation selector by default — the user can opt back in via the
 * "Show Variations" dropdown.
 */
export function getSkippedVariationIndexes(
  experiment: ExperimentWithVariationsAndPhases,
): number[] {
  return getLatestPhaseVariations(experiment)
    .filter((v) => v.status === "passThrough")
    .map((v) => v.index);
}

export type VariationPhaseDisplayStatus = "active" | "passThrough" | "deleted";

export type VariationWithPhaseDisplayStatus = Variation & {
  index: number;
  displayStatus: VariationPhaseDisplayStatus;
};

/**
 * Returns the variations to display for an experiment along with their
 * effective phase status:
 *   - "active" or "passThrough": present in the latest phase
 *   - "deleted": absent from the latest phase but present in at least one
 *     past phase (so it ran historically and we still want to surface it)
 *
 * Variations that aren't referenced by any phase are returned as "active"
 * to match the pre-phase-aware behavior (e.g. brand new draft experiments).
 */
export function getVariationsForDisplay(
  experiment: ExperimentWithVariationsAndPhases,
): VariationWithPhaseDisplayStatus[] {
  const all = getAllVariations(experiment);
  const phases = experiment.phases ?? [];
  const latestPhase = phases[phases.length - 1];

  const latestStatusById = new Map<string, VariationStatus>();
  latestPhase?.variations?.forEach((v) => {
    latestStatusById.set(v.id, v.status);
  });

  const pastPhaseIds = new Set<string>();
  for (let i = 0; i < phases.length - 1; i++) {
    phases[i]?.variations?.forEach((v) => pastPhaseIds.add(v.id));
  }

  return all.map((v) => {
    const latestStatus = latestStatusById.get(v.id);
    if (latestStatus) {
      return { ...v, displayStatus: latestStatus };
    }
    if (pastPhaseIds.has(v.id)) {
      return { ...v, displayStatus: "deleted" as const };
    }
    return { ...v, displayStatus: "active" as const };
  });
}
