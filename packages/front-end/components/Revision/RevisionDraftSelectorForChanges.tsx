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

// Entity-agnostic "new draft / add-to-existing / publish now" picker for the edit
// modals. Per-entity wrappers supply the id and dropdown approval semantics; the
// shared logic (active-draft filtering, label, picker wiring) lives here.
export default function RevisionDraftSelectorForChanges({
  entityId,
  openRevisions,
  allRevisions,
  mode,
  setMode,
  selectedDraftId,
  setSelectedDraftId,
  canAutoPublish,
  approvalRequired,
  defaultExpanded = false,
  triggerPrefix = "Changes will be",
  metadataOnly = false,
  hideExisting = false,
  dropdownRequiresApproval = true,
}: {
  entityId: string;
  openRevisions: Revision[];
  allRevisions: Revision[];
  mode: DraftMode;
  setMode: (m: DraftMode) => void;
  selectedDraftId: string | null;
  setSelectedDraftId: (v: string | null) => void;
  canAutoPublish: boolean;
  approvalRequired: boolean;
  defaultExpanded?: boolean;
  triggerPrefix?: string;
  /**
   * Forwarded to the underlying DraftSelector. Set when the form is editing
   * only metadata fields and the org has metadata review off: hides the
   * publish-now option and switches the radio copy to "revision".
   */
  metadataOnly?: boolean;
  /**
   * Hide the "add to existing draft" option (used by the revert flow, which
   * only offers publish-now vs. create-a-new-draft — mirrors the feature
   * DraftSelectorForChanges `hideExisting`).
   */
  hideExisting?: boolean;
  /**
   * Whether the revision dropdown renders approval-aware status badges. Saved
   * groups use the org approval flow (true); constants opt out (false).
   */
  dropdownRequiresApproval?: boolean;
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
      entityId={entityId}
      allRevisions={allRevisions}
      selectedRevisionId={selectedDraftId}
      onSelectRevision={(rev) => setSelectedDraftId(rev?.id ?? null)}
      draftsOnly
      requiresApproval={dropdownRequiresApproval}
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
