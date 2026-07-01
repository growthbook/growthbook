import { ConfigWithoutValue } from "shared/types/config";
import { Revision } from "shared/enterprise";
import ArchiveModal from "@/components/Revision/ArchiveModal";
import RevisionDraftSelectorForChanges from "@/components/Revision/RevisionDraftSelectorForChanges";
import { ConstantRevisionContext } from "@/components/Constants/useConstantDraftTarget";
import { useConfigFamilyReferences } from "@/hooks/useConstantReferences";
import { useDefinitions } from "@/services/DefinitionsContext";
import Link from "@/ui/Link";

// Thin wrapper around the entity-agnostic ArchiveModal for configs (mirrors
// ConstantArchiveModal). Archiving is blocked while features still reference the
// config family; unarchiving is always allowed.
export default function ConfigArchiveModal({
  config,
  revisionCtx,
  onSaved,
  selectFlow,
  close,
}: {
  config: ConfigWithoutValue;
  revisionCtx: ConstantRevisionContext;
  onSaved?: (revision: Revision) => void;
  selectFlow?: (revision: Revision | null) => void;
  close: () => void;
}) {
  const { mutateDefinitions } = useDefinitions();
  const { openRevisions, allRevisions, approvalRequired, canBypassApproval } =
    revisionCtx;

  const isArchived = !!config.archived;
  const { references, loading } = useConfigFamilyReferences(
    isArchived ? null : config.id,
  );
  const features = references?.features ?? [];

  return (
    <ArchiveModal
      entityNoun="Config"
      entityId={config.id}
      isArchived={isArchived}
      apiPathBase="/configs"
      openRevisions={openRevisions}
      approvalRequired={approvalRequired}
      canBypassApproval={canBypassApproval}
      referenceCount={features.length}
      referencesLoading={loading}
      referencesList={
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {features.map((f) => (
            <li key={f.id}>
              <Link href={`/features/${f.id}`}>{f.name}</Link>
            </li>
          ))}
        </ul>
      }
      renderDraftSelector={({
        mode,
        setMode,
        selectedDraftId,
        setSelectedDraftId,
        canAutoPublish,
        approvalRequired: gated,
      }) => (
        <RevisionDraftSelectorForChanges
          entityId={config.id}
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
      trackingEventModalType="config-archive-modal"
      close={close}
      onRevisionCreated={onSaved}
      selectFlow={selectFlow}
      onSaved={mutateDefinitions}
    />
  );
}
