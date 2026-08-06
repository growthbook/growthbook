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
      // BOTH directions through the shared rule, which picks the atom per
      // direction: delete to take it out of service, publish to return it. NOT
      // ANDed with publish — the endpoint lets a delete-only role archive with no
      // edit rights at all, and requiring publish here hid Archive from the very
      // Deleter role this work introduces, over the environments the
      // constant serves. The server treats either flip as reaching all of them
      // (`flipsArchivedState`), so routing only the archive direction here left
      // Unarchive offered on a footprint the endpoint then refused — and an empty
      // footprint SKIPS the environment check rather than narrowing it.
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
      renderDraftSelector={({
        mode,
        setMode,
        selectedDraftId,
        setSelectedDraftId,
        canAutoPublish,
        approvalRequired: gated,
      }) => (
        <ConstantDraftSelectorForChanges
          constantId={constant.id}
          openRevisions={openRevisions}
          // Only drafts this caller may write `archived` into. The endpoint refuses
          // a write into someone else's draft, so listing them turned a picker
          // choice into a 403.
          canWriteIntoDraft={(r) =>
            canWriteArchiveIntoDraft({
              permissions: permissionsUtil,
              model: "constant",
              entity: constant,
              revision: r,
              userId,
            })
          }
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
