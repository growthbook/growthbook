import {
  ExperimentInterface,
  ExperimentPhase,
  Variation,
  VariationStatus,
} from "shared/types/experiment";
import { DestinationURL } from "shared/types/url-redirect";

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
  const latestPhaseIndex = experiment.phases.length - 1;
  return getPhaseVariations(experiment, latestPhaseIndex);
}

/**
 * Names each of a snapshot's result columns by the variation its saved key
 * belongs to now, as decisions name variations; "" for a key none has. The
 * columns keep their order when variations are reordered later.
 */
export function snapshotColumnVariationIds(
  experiment: ExperimentWithVariationsAndPhases,
  snapshotVariations: { id: string }[],
): string[] {
  const byKey = new Map(
    getLatestPhaseVariations(experiment).map((v, i) => [v.key || i + "", v.id]),
  );
  return snapshotVariations.map((v) => byKey.get(v.id) ?? "");
}

// The latest phase's variations in the shape the experiment stores and writes.
export function getStorableVariations(
  experiment: ExperimentWithVariationsAndPhases,
): Variation[] {
  return getLatestPhaseVariations(experiment).map(
    ({ id, key, name, description, screenshots }) => ({
      id,
      key,
      name,
      description,
      screenshots,
    }),
  );
}

export function getPhaseVariations(
  experiment: ExperimentWithVariationsAndPhases,
  phaseIndex: number,
): VariationWithIndexAndStatus[] {
  const allVariations = getAllVariations(experiment);
  const defaultResponse = allVariations.map((v, i) => ({
    ...v,
    index: i,
    status: "active" as const,
  }));

  const phase = experiment.phases?.[phaseIndex];

  // safe guard in case phase or variations are missing or are an empty array
  if (!phase || !phase.variations || phase.variations.length === 0) {
    return defaultResponse;
  }

  let hasMissing = false;
  const foundVariations: VariationWithIndexAndStatus[] = [];
  for (const v of phase.variations) {
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

// The experiment variation a snapshot result column belongs to. Results are
// indexed by the snapshot's own variation list, keyed at analysis time, which
// can differ from the experiment's current order; a snapshot without keys, or
// a key that no longer resolves, falls back to position. `index` is the
// position in `variations`, so it lines up with `experiment.winner`.
export function resolveSnapshotVariation<V extends { id: string; key: string }>(
  variations: V[],
  snapshotVariations: { id: string }[] | undefined,
  column: number,
): { variation: V; index: number } | null {
  const key = snapshotVariations?.[column]?.id;
  const variation =
    (key !== undefined
      ? (variations.find((v) => v.key === key) ??
        variations.find((v) => v.id === key))
      : undefined) ?? variations[column];
  return variation ? { variation, index: variations.indexOf(variation) } : null;
}

// One destination per variation, as an experiment's variation sync leaves a redirect.
export function syncedDestinationURLs(
  destinationURLs: DestinationURL[],
  variations: Pick<Variation, "id">[],
): DestinationURL[] {
  const byVariation = new Map(destinationURLs.map((d) => [d.variation, d]));
  return variations.map(
    ({ id }) => byVariation.get(id) ?? { variation: id, url: "" },
  );
}
