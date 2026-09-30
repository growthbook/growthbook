import { Revision, getSdkConnectionApprovalRule } from "shared/enterprise";
import { SDKConnectionInterface } from "shared/types/sdk-connection";
import {
  canLandArchiveToggle,
  canStageArchiveDraft,
  canWriteArchiveIntoDraft,
} from "shared/permissions";
import ArchiveModal from "@/components/Revision/ArchiveModal";
import RevisionDraftSelectorForChanges from "@/components/Revision/RevisionDraftSelectorForChanges";
import useOrgSettings from "@/hooks/useOrgSettings";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useUser } from "@/services/UserContext";

interface SDKConnectionArchiveModalProps {
  connection: SDKConnectionInterface;
  close: () => void;
  openRevisions: Revision[];
  allRevisions: Revision[];
  mutate: () => void;
  onRevisionCreated?: (revision: Revision) => void;
  selectFlow?: (revision: Revision | null) => void;
}

// Thin wrapper around the entity-agnostic ArchiveModal. Nothing references an
// SDK connection, so archiving is never reference-blocked.
export default function SDKConnectionArchiveModal({
  connection,
  close,
  openRevisions,
  allRevisions,
  mutate,
  onRevisionCreated,
  selectFlow,
}: SDKConnectionArchiveModalProps) {
  const settings = useOrgSettings();
  const permissionsUtil = usePermissionsUtil();
  const { hasCommercialFeature, userId } = useUser();

  const isArchived = !!connection.archived;

  const canBypass = connection.projects?.length
    ? connection.projects.every((p) =>
        permissionsUtil.canBypassSDKConnectionApprovalChecks({
          project: p || "",
        }),
      )
    : permissionsUtil.canBypassSDKConnectionApprovalChecks({ project: "" });

  const approvalRequired =
    hasCommercialFeature("require-approvals") &&
    !!getSdkConnectionApprovalRule(settings.approvalFlows, {
      projects: connection.projects,
      environment: connection.environment,
    });

  return (
    <ArchiveModal
      entityNoun="SDK Connection"
      preserveNounCase
      entityId={connection.id}
      isArchived={isArchived}
      apiPathBase="/sdk-connections"
      openRevisions={openRevisions}
      approvalRequired={approvalRequired}
      canBypassApproval={canBypass}
      // Archiving is delete-class; unarchiving is publish-class. Both are
      // scoped to the one environment the connection serves.
      canLand={canLandArchiveToggle(
        permissionsUtil,
        "sdk-connection",
        connection,
        [connection.environment],
      )}
      referenceCount={0}
      referencesLoading={false}
      referencesList={null}
      canStageDraft={canStageArchiveDraft({
        permissions: permissionsUtil,
        model: "sdk-connection",
        entity: connection,
        archived: !isArchived,
      })}
      canWriteIntoDraft={(r) =>
        canWriteArchiveIntoDraft({
          permissions: permissionsUtil,
          model: "sdk-connection",
          entity: connection,
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
        canDraft,
      }) => (
        <RevisionDraftSelectorForChanges
          entityId={connection.id}
          openRevisions={openRevisions}
          allRevisions={allRevisions}
          canWriteIntoDraft={canWriteIntoDraft}
          canDraft={canDraft}
          mode={mode}
          setMode={setMode}
          selectedDraftId={selectedDraftId}
          setSelectedDraftId={setSelectedDraftId}
          canAutoPublish={canAutoPublish}
          approvalRequired={gated}
          dropdownRequiresApproval={false}
        />
      )}
      trackingEventModalType="sdk-connection-archive-modal"
      close={close}
      onRevisionCreated={onRevisionCreated}
      selectFlow={selectFlow}
      onSaved={mutate}
    />
  );
}
