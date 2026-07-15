import { ConfigWithoutValue } from "shared/types/config";
import { Revision } from "shared/enterprise";
import ArchiveModal from "@/components/Revision/ArchiveModal";
import RevisionDraftSelectorForChanges from "@/components/Revision/RevisionDraftSelectorForChanges";
import { ConstantRevisionContext } from "@/components/Constants/useConstantDraftTarget";
import { useConfigFamilyReferences } from "@/hooks/useConstantReferences";
import { useDefinitions } from "@/services/DefinitionsContext";
import Link from "@/ui/Link";

// Thin wrapper around the entity-agnostic ArchiveModal for configs (mirrors
// ConstantArchiveModal). References are informational, not a hard block: the
// server allows archiving a child/env-override whose live patch is empty or
// unused, and soft-warns (confirm to proceed) when it's actively serving a
// value. Unarchiving is always allowed.
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
  const { references, loading, error } = useConfigFamilyReferences(
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
      referencesError={(error ?? null) !== null}
      // The server decides archivability for configs (a child/env-override with
      // an empty or unused patch archives outright; a live-serving one returns a
      // soft warning to confirm), so references are informational, not a block.
      referenceBlockMode="soft"
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
