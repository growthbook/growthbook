import { useMemo } from "react";
import { SavedGroupInterface } from "shared/types/saved-group";
import {
  Revision,
  checkMergeConflicts,
  normalizeProposedChanges,
} from "shared/enterprise";
import FixRevisionConflictsModal from "@/components/Revision/FixRevisionConflictsModal";

interface SavedGroupConflictModalProps {
  savedGroup: SavedGroupInterface;
  selectedRevision: Revision;
  close: () => void;
  mutate: () => void;
}

export function SavedGroupConflictModal({
  savedGroup,
  selectedRevision,
  close,
  mutate,
}: SavedGroupConflictModalProps) {
  return (
    <FixRevisionConflictsModal
      revision={selectedRevision}
      currentState={savedGroup as unknown as Record<string, unknown>}
      close={close}
      mutate={mutate}
    />
  );
}

export function useSavedGroupMergeResult(
  savedGroup: SavedGroupInterface | undefined,
  selectedRevision: Revision | null,
  _allRevisions: Revision[],
  isDraft: boolean | Revision | null,
) {
  return useMemo(() => {
    if (!savedGroup || !selectedRevision || !isDraft) return null;
    if (selectedRevision.target.type !== "saved-group") return null;

    const baseSnapshot = selectedRevision.target.snapshot;

    // Can't detect conflicts without a base snapshot (old revisions may not have one)
    if (!baseSnapshot) return null;

    const proposedChanges = normalizeProposedChanges(
      selectedRevision.target.proposedChanges,
    );

    return checkMergeConflicts(
      baseSnapshot as Record<string, unknown>,
      savedGroup as unknown as Record<string, unknown>,
      proposedChanges,
    );
  }, [savedGroup, selectedRevision, isDraft]);
}
