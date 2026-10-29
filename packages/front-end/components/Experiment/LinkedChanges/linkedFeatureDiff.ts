import isEqual from "lodash/isEqual";
import { LinkedFeatureInfo } from "shared/types/experiment";
import { FeatureInterface } from "shared/types/feature";

type DiffInput = Pick<
  LinkedFeatureInfo,
  "liveValues" | "liveSparse" | "pendingDraft" | "liveEnvironmentStates"
> & { feature: Pick<FeatureInterface, "defaultValue"> };

/** Whether the draft would move where the experiment runs. */
function environmentStatesDiffer(
  info: Pick<DiffInput, "liveEnvironmentStates" | "pendingDraft">,
): boolean {
  if (!info.pendingDraft) return false;
  if (!info.liveEnvironmentStates) return true;
  return !isEqual(
    info.pendingDraft.environmentStates,
    info.liveEnvironmentStates,
  );
}

/** Whether sparse values would expand differently: the flag flips, or the default they merge onto moves. */
function sparseExpansionDiffers(info: DiffInput): boolean {
  const draft = info.pendingDraft;
  if (!draft) return false;
  if (!!draft.sparse !== !!info.liveSparse) return true;
  return draft.sparse && draft.defaultValue !== info.feature.defaultValue;
}

/**
 * Whether the flag's draft moves anything the experiment page shows. A draft
 * can change its rule without moving a value, so a draft alone isn't enough.
 */
export function hasUnpublishedChanges(info: DiffInput): boolean {
  if (!info.pendingDraft) return false;
  return (
    (info.pendingDraft.values ?? []).some(
      (v) =>
        info.liveValues?.find((l) => l.variationId === v.variationId)?.value !==
        v.value,
    ) ||
    sparseExpansionDiffers(info) ||
    environmentStatesDiffer(info)
  );
}
