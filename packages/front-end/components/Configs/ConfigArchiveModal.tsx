import { ConfigWithoutValue } from "shared/types/config";
import { Revision } from "shared/enterprise";
import { configPublishEnvironments } from "shared/util";
import {
  canStageArchiveDraft,
  canWriteArchiveIntoDraft,
  archiveFootprintForControl,
  canLandArchiveToggle,
} from "shared/permissions";
import ArchiveModal from "@/components/Revision/ArchiveModal";
import RevisionDraftSelectorForChanges from "@/components/Revision/RevisionDraftSelectorForChanges";
import { ConstantRevisionContext } from "@/components/Constants/useConstantDraftTarget";
import { useConfigFamilyReferences } from "@/hooks/useConstantReferences";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useEnvironments } from "@/services/features";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useUser } from "@/services/UserContext";
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
  const permissionsUtil = usePermissionsUtil();
  const { userId } = useUser();
  const environments = useEnvironments();

  const isArchived = !!config.archived;
  const { references, loading, error } = useConfigFamilyReferences(
    isArchived ? null : config.id,
  );
  // family-references returns every feature referencing ANY config in the
  // lineage family; narrow to features that consume THIS config's value
  // (default-backed or via a rule) so a harmless child/override archive doesn't
  // claim it breaks flags the server considers unaffected. The server remains
  // authoritative — a residual mismatch surfaces as the soft-warning backstop.
  const features = (references?.features ?? []).filter(
    (f) =>
      f.defaultConfigKey === config.key ||
      f.ruleConfigKeys.includes(config.key),
  );

  return (
    <ArchiveModal
      entityNoun="Config"
      entityId={config.id}
      isArchived={isArchived}
      apiPathBase="/configs"
      openRevisions={openRevisions}
      approvalRequired={approvalRequired}
      canBypassApproval={canBypassApproval}
      // Archive requires delete authority; unarchive requires publish authority.
      canLand={canLandArchiveToggle(
        permissionsUtil,
        "config",
        config,
        archiveFootprintForControl({
          environments,
          entity: config,
          scoped: configPublishEnvironments(config),
        }),
      )}
      referenceCount={features.length}
      referencesLoading={loading}
      referencesError={(error ?? null) !== null}
      // The server decides archivability for configs (a child/env-override with
      // an empty or unused patch archives outright; a live-serving one returns a
      // soft warning to confirm), so references are acknowledged, not blocked.
      referenceBlockMode="soft"
      // referenceCount here is live feature-flag consumers — the dangerous case
      // that warrants the elevated "this will break them" confirmation.
      elevatedWarning
      referencesList={
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {features.map((f) => (
            <li key={f.id}>
              <Link href={`/features/${f.id}`}>{f.name}</Link>
            </li>
          ))}
        </ul>
      }
      // Drafts the archive flip may be written into, for both the picker and
      // this modal's initial selection.
      // Left to the shell's `true` default, a publish-only caller was offered
      // "Create a new draft" on an unarchive the endpoint then refuses.
      canStageDraft={canStageArchiveDraft({
        permissions: permissionsUtil,
        model: "config",
        entity: config,
        archived: !config.archived,
      })}
      canWriteIntoDraft={(r) =>
        canWriteArchiveIntoDraft({
          permissions: permissionsUtil,
          model: "config",
          entity: config,
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
          entityId={config.id}
          openRevisions={openRevisions}
          canWriteIntoDraft={canWriteIntoDraft}
          canDraft={canDraft}
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
