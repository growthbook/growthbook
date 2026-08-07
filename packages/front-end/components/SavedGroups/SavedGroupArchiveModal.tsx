import { canWriteArchiveIntoDraft } from "shared/permissions";
import { SavedGroupInterface } from "shared/types/saved-group";
import { Revision } from "shared/enterprise";
import useOrgSettings from "@/hooks/useOrgSettings";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useUser } from "@/services/UserContext";
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
  const { userId } = useUser();

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
          permissionsUtil.canBypassSavedGroupApprovalChecks({
            project: proj || "",
          }),
        )
      : permissionsUtil.canBypassSavedGroupApprovalChecks({ project: "" });

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
      // Archiving is delete-class; unarchiving is an ordinary publish.
      canLand={
        isArchived
          ? permissionsUtil.canRevisionAction(
              "saved-group",
              "publish",
              savedGroup,
            )
          : permissionsUtil.canDeleteSavedGroup(savedGroup)
      }
      referenceCount={totalReferences}
      referencesLoading={loading}
      // The server is the source of truth: archiving a still-referenced Saved
      // Group returns a soft warning the user acknowledges via the shared
      // apiCall handler, rather than a client-side hard block.
      referenceBlockMode="soft"
      preserveNounCase
      referencesList={
        <SavedGroupReferencesList
          features={references?.features ?? []}
          experiments={references?.experiments ?? []}
          savedGroups={references?.savedGroups ?? []}
        />
      }
      // Only drafts this caller may write `archived` into — the endpoint refuses a
      // write into another author's draft, so listing them turned a picker choice
      // into a 403.
      // Staging follows the server's directional rule: archiving is delete-class so
      // the delete atom stages one, unarchiving needs draft authority. Left to the
      // shell's `true` default, a publish-only caller was offered "Create a new
      // draft" on an unarchive the endpoint refuses.
      canStageDraft={
        permissionsUtil.canRevisionAction("saved-group", "draft", savedGroup) ||
        (!savedGroup.archived &&
          permissionsUtil.canRevisionAction(
            "saved-group",
            "delete",
            savedGroup,
          ))
      }
      canWriteIntoDraft={(r) =>
        canWriteArchiveIntoDraft({
          permissions: permissionsUtil,
          model: "saved-group",
          entity: savedGroup,
          revision: r,
          userId,
        })
      }
      renderDraftSelector={({
        mode,
        setMode,
        selectedDraftId,
        setSelectedDraftId,
        canAutoPublish,
        approvalRequired: gated,
        canWriteIntoDraft,
      }) => (
        <SavedGroupDraftSelectorForChanges
          savedGroup={savedGroup}
          openRevisions={openRevisions}
          canWriteIntoDraft={canWriteIntoDraft}
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
