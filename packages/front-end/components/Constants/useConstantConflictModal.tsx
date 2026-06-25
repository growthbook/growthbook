import { useEffect, useMemo } from "react";
import { ConstantInterface } from "shared/types/constant";
import { ConfigInterface } from "shared/types/config";
import {
  Revision,
  checkMergeConflicts,
  normalizeProposedChanges,
} from "shared/enterprise";
import FixRevisionConflictsModal from "@/components/Revision/FixRevisionConflictsModal";

interface ConstantConflictModalProps {
  constant: ConstantInterface | ConfigInterface;
  selectedRevision: Revision;
  close: () => void;
  mutate: () => void | Promise<void>;
}

export function ConstantConflictModal({
  constant,
  selectedRevision,
  close,
  mutate,
}: ConstantConflictModalProps) {
  // Refresh constant + revisions on open so the client computes its conflict
  // preview against the latest live state.
  useEffect(() => {
    void mutate();
    // Intentionally run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <FixRevisionConflictsModal
      revision={selectedRevision}
      currentState={constant as unknown as Record<string, unknown>}
      close={close}
      mutate={mutate}
    />
  );
}

export function useConstantMergeResult(
  constant: ConstantInterface | ConfigInterface | undefined,
  selectedRevision: Revision | null,
  isDraft: boolean | Revision | null,
  targetType: "constant" | "config" = "constant",
) {
  return useMemo(() => {
    if (!constant || !selectedRevision || !isDraft) return null;
    if (selectedRevision.target.type !== targetType) return null;

    const baseSnapshot = selectedRevision.target.snapshot;
    if (!baseSnapshot) return null;

    const proposedChanges = normalizeProposedChanges(
      selectedRevision.target.proposedChanges,
    );

    return checkMergeConflicts(
      baseSnapshot as Record<string, unknown>,
      constant as unknown as Record<string, unknown>,
      proposedChanges,
    );
  }, [constant, selectedRevision, isDraft, targetType]);
}
