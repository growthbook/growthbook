import isEqual from "lodash/isEqual";
import { LinkedFeatureInfo } from "shared/types/experiment";
import { ExperimentRefVariation } from "shared/types/feature";

export type VariationValueChange = {
  variationId: string;
  before?: string;
  after: string;
  // Moved against a live value. False without one: there is nothing to diff.
  changed: boolean;
  // Not yet serving — `changed`, or a rule that has never published at all.
  unpublished: boolean;
};

const valueFor = (
  values: ExperimentRefVariation[] | undefined,
  variationId: string,
) => values?.find((v) => v.variationId === variationId)?.value;

/**
 * The draft's values against live, per variation. A draft differs from live
 * across its whole rule, so callers that ask about values specifically —
 * whether to render a diff, whether to mark a readout unpublished — have to
 * compare here rather than trust that a draft exists.
 */
export function getVariationValueChanges(
  info: Pick<LinkedFeatureInfo, "values" | "liveValues" | "pendingDraft">,
  variationIds: string[],
): VariationValueChange[] {
  const draft = info.pendingDraft?.values ?? info.values;
  return variationIds.map((variationId) => {
    const after = valueFor(draft, variationId) ?? "";
    const before = valueFor(info.liveValues, variationId);
    const changed = before !== undefined && before !== after;
    return {
      variationId,
      before,
      after,
      changed,
      unpublished: changed || before === undefined,
    };
  });
}

/** Whether the draft would move where the experiment runs. */
export function environmentStatesDiffer(
  info: Pick<LinkedFeatureInfo, "liveEnvironmentStates" | "pendingDraft">,
): boolean {
  if (!info.pendingDraft) return false;
  if (!info.liveEnvironmentStates) return true;
  return !isEqual(
    info.pendingDraft.environmentStates,
    info.liveEnvironmentStates,
  );
}
