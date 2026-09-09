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
  phases?: { namespace?: { enabled?: boolean } }[];
};

// Archiving or deleting drops the experiment from the SDK payload, so the caller
// must first say what happens to anything still serving through it.
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

// Only a temporary rollout has a single released value to keep, only a
// Feature Flag rule can hold it, and a force rule has no namespace to keep.
export function canMaterializeLinkedChanges(
  experiment: BlockerExperiment,
  blocker: ExperimentLinkageBlocker | null,
): boolean {
  const phase = experiment.phases?.[experiment.phases.length - 1];
  return (
    blocker === "temporary-rollout" &&
    !experiment.hasVisualChangesets &&
    !experiment.hasURLRedirects &&
    !phase?.namespace?.enabled
  );
}
