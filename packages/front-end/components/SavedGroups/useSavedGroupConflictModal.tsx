import { useEffect, useMemo } from "react";
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
  mutate: () => void | Promise<void>;
}

export function SavedGroupConflictModal({
  savedGroup,
  selectedRevision,
  close,
  mutate,
}: SavedGroupConflictModalProps) {
  // Refresh saved-group + revisions on open so the client computes its
  // conflict preview against the latest live state. Without this, if another
  // change was auto-published while the user was looking at a stale draft,
  // the client's merge result would drift from the server's and the rebase
  // optimistic-lock would reject the submission.
  useEffect(() => {
    void mutate();
    // Intentionally run once on mount; `mutate` identity changes are not
    // meaningful here and would cause redundant refetches mid-resolution.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
