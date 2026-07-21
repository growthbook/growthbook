import { SavedGroupInterface } from "shared/types/saved-group";
import { Revision } from "shared/enterprise";
import useOrgSettings from "@/hooks/useOrgSettings";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useSavedGroupReferences } from "@/hooks/useSavedGroupReferences";
import ArchiveModal from "@/components/Revision/ArchiveModal";
import SavedGroupDraftSelectorForChanges from "@/components/SavedGroups/SavedGroupDraftSelectorForChanges";
import SavedGroupReferencesList from "./SavedGroupReferencesList";

interface SavedGroupArchiveModalProps {
  savedGroup: SavedGroupInterface;
  close: () => void;
  openRevisions: Revision[];
  allRevisions: Revision[];
  mutate: () => void;
  onRevisionCreated?: (revision: Revision) => void;
  selectFlow?: (revision: Revision | null) => void;
}

// Thin wrapper around the entity-agnostic ArchiveModal.
export default function SavedGroupArchiveModal({
  savedGroup,
  close,
  openRevisions,
  allRevisions,
  mutate,
  onRevisionCreated,
  selectFlow,
}: SavedGroupArchiveModalProps) {
  const settings = useOrgSettings();
  const permissionsUtil = usePermissionsUtil();

  const isArchived = !!savedGroup.archived;

  // Only look up references when archiving (unarchiving is never blocked).
  const { references, loading } = useSavedGroupReferences(
    isArchived ? null : savedGroup.id,
  );
  const totalReferences =
    (references?.features.length ?? 0) +
    (references?.experiments.length ?? 0) +
    (references?.savedGroups.length ?? 0);

  const canBypass =
    savedGroup.projects && savedGroup.projects.length > 0
      ? savedGroup.projects.every((proj) =>
          permissionsUtil.canBypassApprovalChecks({ project: proj || "" }),
        )
      : permissionsUtil.canBypassApprovalChecks({ project: "" });

  const approvalRequired =
    settings.approvalFlows?.savedGroups?.[0]?.required ?? false;

  return (
    <ArchiveModal
      entityNoun="Saved Group"
      entityId={savedGroup.id}
      isArchived={isArchived}
      apiPathBase="/saved-groups"
      openRevisions={openRevisions}
      approvalRequired={approvalRequired}
      canBypassApproval={canBypass}
      referenceCount={totalReferences}
      referencesLoading={loading}
      referencesList={
        <SavedGroupReferencesList
          features={references?.features ?? []}
          experiments={references?.experiments ?? []}
          savedGroups={references?.savedGroups ?? []}
        />
      }
      renderDraftSelector={({
        mode,
        setMode,
        selectedDraftId,
        setSelectedDraftId,
        canAutoPublish,
        approvalRequired: gated,
      }) => (
        <SavedGroupDraftSelectorForChanges
          savedGroup={savedGroup}
          openRevisions={openRevisions}
          allRevisions={allRevisions}
          mode={mode}
          setMode={setMode}
          selectedDraftId={selectedDraftId}
          setSelectedDraftId={setSelectedDraftId}
          canAutoPublish={canAutoPublish}
          approvalRequired={gated}
        />
      )}
      trackingEventModalType="saved-group-archive-modal"
      close={close}
      onRevisionCreated={onRevisionCreated}
      selectFlow={selectFlow}
      onSaved={mutate}
    />
  );
}
