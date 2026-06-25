import { useMemo } from "react";
import { Revision } from "shared/enterprise";
import DraftSelector, { DraftMode } from "@/components/DraftSelector";
import RevisionDropdown from "@/components/Revision/RevisionDropdown";

export type { DraftMode };

const ACTIVE_DRAFT_STATUSES = new Set([
  "draft",
  "pending-review",
  "changes-requested",
  "approved",
]);

// Constant equivalent of SavedGroupDraftSelectorForChanges: the "new draft vs.
// add-to-existing vs. publish now" picker shown at the top of the edit modals.
export default function ConstantDraftSelectorForChanges({
  constantId,
  openRevisions,
  allRevisions,
  mode,
  setMode,
  selectedDraftId,
  setSelectedDraftId,
  canAutoPublish,
  approvalRequired,
  metadataOnly = false,
}: {
  constantId: string;
  openRevisions: Revision[];
  allRevisions: Revision[];
  mode: DraftMode;
  setMode: (m: DraftMode) => void;
  selectedDraftId: string | null;
  setSelectedDraftId: (v: string | null) => void;
  canAutoPublish: boolean;
  approvalRequired: boolean;
  metadataOnly?: boolean;
}) {
  const activeDrafts = useMemo(
    () => openRevisions.filter((r) => ACTIVE_DRAFT_STATUSES.has(r.status)),
    [openRevisions],
  );

  const selectedDraftRevision = useMemo(
    () => allRevisions.find((r) => r.id === selectedDraftId) ?? null,
    [allRevisions, selectedDraftId],
  );

  const existingDraftLabel = selectedDraftRevision
    ? selectedDraftRevision.title ||
      `Revision ${
        allRevisions.filter(
          (r) =>
            new Date(r.dateCreated) <=
            new Date(selectedDraftRevision.dateCreated),
        ).length
      }`
    : null;

  const revisionDropdown = (
    <RevisionDropdown
      entityId={constantId}
      allRevisions={allRevisions}
      selectedRevisionId={selectedDraftId}
      onSelectRevision={(rev) => setSelectedDraftId(rev?.id ?? null)}
      draftsOnly
      requiresApproval={false}
    />
  );

  return (
    <DraftSelector
      hasActiveDrafts={activeDrafts.length > 0}
      mode={mode}
      setMode={setMode}
      canAutoPublish={canAutoPublish}
      approvalRequired={approvalRequired}
      triggerPrefix="Changes will be"
      existingDraftLabel={existingDraftLabel}
      revisionDropdown={revisionDropdown}
      metadataOnly={metadataOnly}
    />
  );
}
