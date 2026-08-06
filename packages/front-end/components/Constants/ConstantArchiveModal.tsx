import {
  canWriteArchiveIntoDraft,
  archiveFootprintForControl,
  canLandArchiveToggle,
} from "shared/permissions";
import { ConstantWithoutValue } from "shared/types/constant";
import { Revision } from "shared/enterprise";
import ArchiveModal from "@/components/Revision/ArchiveModal";
import ConstantDraftSelectorForChanges from "@/components/Constants/ConstantDraftSelectorForChanges";
import { ConstantRevisionContext } from "@/components/Constants/useConstantDraftTarget";
import ConstantReferencesList from "@/components/Constants/ConstantReferencesList";
import { useConstantReferences } from "@/hooks/useConstantReferences";
import { useDefinitions } from "@/services/DefinitionsContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useUser } from "@/services/UserContext";
import { useEnvironments } from "@/services/features";

// Thin wrapper around the entity-agnostic ArchiveModal.
export default function ConstantArchiveModal({
  constant,
  revisionCtx,
  onSaved,
  selectFlow,
  close,
}: {
  constant: ConstantWithoutValue;
  revisionCtx: ConstantRevisionContext;
  onSaved?: (revision: Revision) => void;
  selectFlow?: (revision: Revision | null) => void;
  close: () => void;
}) {
  const { mutateDefinitions } = useDefinitions();

  const { openRevisions, allRevisions, approvalRequired, canBypassApproval } =
    revisionCtx;
  const permissionsUtil = usePermissionsUtil();
  const { userId } = useUser();
  const environments = useEnvironments();

  const isArchived = !!constant.archived;

  // Only look up references when archiving (unarchiving is never blocked).
  const { references, loading, error } = useConstantReferences(
    isArchived ? null : constant.id,
  );
  const totalReferences =
    (references?.features.length ?? 0) + (references?.constants.length ?? 0);

  return (
    <ArchiveModal
      entityNoun="Constant"
      entityId={constant.id}
      isArchived={isArchived}
      apiPathBase="/constants"
      openRevisions={openRevisions}
      approvalRequired={approvalRequired}
      canBypassApproval={canBypassApproval}
      // Archive requires delete authority; unarchive requires publish authority.
      canLand={canLandArchiveToggle(
        permissionsUtil,
        "constant",
        constant,
        archiveFootprintForControl({ environments, entity: constant }),
      )}
      referenceCount={totalReferences}
      referencesLoading={loading}
      referencesError={(error ?? null) !== null}
      // The server is the source of truth: archiving a still-referenced constant
      // returns a soft warning the user acknowledges via the shared apiCall
      // handler, rather than a client-side hard block.
      referenceBlockMode="soft"
      referencesList={
        <ConstantReferencesList
          features={references?.features ?? []}
          constants={references?.constants ?? []}
        />
      }
      // Drafts the archive flip may be written into, for both the picker and
      // this modal's initial selection.
      canWriteIntoDraft={(r) =>
        canWriteArchiveIntoDraft({
          permissions: permissionsUtil,
          model: "constant",
          entity: constant,
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
        <ConstantDraftSelectorForChanges
          constantId={constant.id}
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
      trackingEventModalType="constant-archive-modal"
      close={close}
      onRevisionCreated={onSaved}
      selectFlow={selectFlow}
      onSaved={mutateDefinitions}
    />
  );
}
