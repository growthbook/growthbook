/**
 * Saved Group Conflict Resolution
 *
 * This file provides a wrapper around the generic FixConflictsModal for saved groups.
 * It handles saved group-specific conflict detection and resolution.
 */
import { useMemo } from "react";
import { SavedGroupInterface } from "shared/types/saved-group";
import { Revision } from "shared/enterprise";
import { autoMergeSavedGroup } from "shared/util";
import FixConflictsModal, {
  AutoMergeResult,
} from "@/components/Revision/FixConflictsModal";
import { REVISION_SAVED_GROUP_DIFF_CONFIG } from "@/components/Revision/RevisionDiffConfig";

interface SavedGroupConflictModalProps {
  savedGroup: SavedGroupInterface;
  revisions: Revision[];
  selectedRevision: Revision;
  close: () => void;
  mutate: () => void;
}

export function SavedGroupConflictModal({
  savedGroup,
  revisions,
  selectedRevision,
  close,
  mutate,
}: SavedGroupConflictModalProps) {
  return (
    <FixConflictsModal<SavedGroupInterface, Partial<SavedGroupInterface>>
      entityName="saved-group"
      entity={savedGroup}
      revisions={revisions}
      selectedRevision={selectedRevision}
      diffConfig={REVISION_SAVED_GROUP_DIFF_CONFIG}
      autoMerge={(_live, base, revision, proposedChanges, strategies) =>
        autoMergeSavedGroup(
          revision,
          base,
          revision,
          proposedChanges,
          strategies,
        ) as AutoMergeResult<Partial<SavedGroupInterface>>
      }
      applyMergeResult={(entity, result) => ({ ...entity, ...result })}
      close={close}
      mutate={mutate}
    />
  );
}

export function useSavedGroupMergeResult(
  savedGroup: SavedGroupInterface | undefined,
  selectedRevision: Revision | null,
  allRevisions: Revision[],
  isDraft: boolean | Revision | null,
) {
  return useMemo(() => {
    if (!savedGroup || !selectedRevision || !isDraft) return null;
    if (selectedRevision.target.type !== "saved-group") return null;

    const baseSnapshot = selectedRevision.target.snapshot;
    const proposedChanges = selectedRevision.target.proposedChanges;

    // Can't detect conflicts without a base snapshot (old revisions may not have one)
    if (!baseSnapshot) return null;

    // Run auto-merge to detect conflicts
    return autoMergeSavedGroup(
      savedGroup,
      baseSnapshot,
      savedGroup,
      proposedChanges,
      {},
    );
  }, [savedGroup, selectedRevision, isDraft]);
}
