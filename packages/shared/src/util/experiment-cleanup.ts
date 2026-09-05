import type { LinkedFeatureInfo } from "shared/types/experiment";

/** What to do with a linked Feature Flag that would otherwise be left serving nothing. */
export type LinkedChangesResolution = "materialize" | "remove";
export const linkedChangesResolutions = ["materialize", "remove"] as const;

export type ExperimentLinkageBlocker = "temporary-rollout" | "running";

type BlockerExperiment = {
  status: string;
  archived?: boolean;
  releasedVariationId?: string;
  excludeFromPayload?: boolean;
  hasVisualChangesets?: boolean;
  hasURLRedirects?: boolean;
};

// Archiving or deleting drops the experiment from the SDK payload, so anything
// still serving through it stops. Both cases need the caller to say what
// happens to the linked changes first.
export function getExperimentLinkageBlocker(
  experiment: BlockerExperiment,
  linkedFeatures: Pick<LinkedFeatureInfo, "state">[],
): ExperimentLinkageBlocker | null {
  if (experiment.archived) return null;
  const serving =
    linkedFeatures.some((f) => f.state === "live") ||
    !!experiment.hasVisualChangesets ||
    !!experiment.hasURLRedirects;
  if (!serving) return null;
  if (experiment.status === "running") return "running";
  if (
    experiment.status === "stopped" &&
    !!experiment.releasedVariationId &&
    !experiment.excludeFromPayload
  ) {
    return "temporary-rollout";
  }
  return null;
}

// Only a temporary rollout has a single released value to keep, and only a
// Feature Flag rule can hold it.
export function canMaterializeLinkedChanges(
  experiment: BlockerExperiment,
  blocker: ExperimentLinkageBlocker | null,
): boolean {
  return (
    blocker === "temporary-rollout" &&
    !experiment.hasVisualChangesets &&
    !experiment.hasURLRedirects
  );
}
