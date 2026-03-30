import { useMemo } from "react";
import { SavedGroupInterface } from "shared/types/saved-group";
import { Revision } from "shared/enterprise";
import DraftSelector, { DraftMode } from "@/components/DraftSelector";
import SavedGroupRevisionDropdown from "./SavedGroupRevisionDropdown";

export type { DraftMode };

const ACTIVE_DRAFT_STATUSES = new Set([
  "draft",
  "pending-review",
  "changes-requested",
  "approved",
]);

export default function SavedGroupDraftSelectorForChanges({
  savedGroup,
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
}: {
  savedGroup: SavedGroupInterface;
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
    <SavedGroupRevisionDropdown
      savedGroupId={savedGroup.id}
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
      defaultExpanded={defaultExpanded}
      triggerPrefix={triggerPrefix}
      existingDraftLabel={existingDraftLabel}
      revisionDropdown={revisionDropdown}
    />
  );
}
