import { useMemo } from "react";
import { Revision } from "shared/enterprise";
import { DraftMode } from "@/components/DraftSelector";
import SharedDraftSelectorForChanges from "@/components/DraftSelectorForChanges";
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
  defaultExpanded = false,
  triggerPrefix = "Changes will be",
  hideExisting = false,
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
  defaultExpanded?: boolean;
  triggerPrefix?: string;
  /**
   * Hide the "add to existing draft" option (used by the revert flow, which
   * only offers publish-now vs. create-a-new-draft — mirrors the feature
   * DraftSelectorForChanges `hideExisting`).
   */
  hideExisting?: boolean;
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
    <SharedDraftSelectorForChanges<string>
      activeDraftKeys={activeDrafts.map((r) => r.id)}
      selectedDraft={selectedDraftId}
      setSelectedDraft={setSelectedDraftId}
      mode={mode}
      setMode={setMode}
      canAutoPublish={canAutoPublish}
      approvalRequired={approvalRequired}
      existingDraftLabel={existingDraftLabel}
      revisionDropdown={revisionDropdown}
      defaultExpanded={defaultExpanded}
      hideExisting={hideExisting}
      triggerPrefix={triggerPrefix}
      metadataOnly={metadataOnly}
    />
  );
}
