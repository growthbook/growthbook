import isEqual from "lodash/isEqual";
import { LinkedFeatureInfo } from "shared/types/experiment";

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

/**
 * Whether the flag's draft moves anything the experiment page shows. A draft
 * can change its rule without moving a value, so a draft alone isn't enough.
 */
export function hasUnpublishedChanges(
  info: Pick<
    LinkedFeatureInfo,
    "liveValues" | "pendingDraft" | "liveEnvironmentStates"
  >,
): boolean {
  if (!info.pendingDraft) return false;
  return (
    (info.pendingDraft.values ?? []).some(
      (v) =>
        info.liveValues?.find((l) => l.variationId === v.variationId)?.value !==
        v.value,
    ) || environmentStatesDiffer(info)
  );
}
