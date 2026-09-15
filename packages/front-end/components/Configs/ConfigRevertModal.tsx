import { Revision } from "shared/enterprise";
import { ConfigInterface } from "shared/types/config";
import RevertModal from "@/components/Revision/RevertModal";
import { RevisionDiffConfig } from "@/components/Revision/useRevisionDiff";
import RevisionDraftSelectorForChanges from "@/components/Revision/RevisionDraftSelectorForChanges";

// Fields a config revert can restore. `archived` is handled separately via an
// explicit opt-in (mirrors ConstantRevertModal).
const REVERTABLE_FIELDS = [
  "name",
  "owner",
  "description",
  "project",
  "value",
  "parent",
  "extends",
  "schema",
  "extensible",
  "renderProjections",
] as const satisfies readonly (keyof ConfigInterface)[];

export interface Props {
  config: ConfigInterface;
  revision: Revision;
  allRevisions: Revision[];
  diffConfig: RevisionDiffConfig<ConfigInterface>;
  revertsBypassApproval: boolean;
  approvalRequired: boolean;
  canBypassApproval: boolean;
  canRevert: boolean;
  canLandRevert?: boolean;
  // Per-target: restoring an older snapshot can relocate the entity, so the
  // destination has to be re-derived for whichever target the picker lands on.
  canLandRevertForTarget?: (targetRevision: Revision) => boolean;
  canLandArchive?: boolean;
  canDraft: boolean;
  close: () => void;
  onRevisionCreated: (revision: Revision) => void;
}

// Thin wrapper around the entity-agnostic RevertModal.
export default function ConfigRevertModal({ config, ...rest }: Props) {
  return (
    <RevertModal<ConfigInterface>
      liveEntity={config}
      revertableFields={REVERTABLE_FIELDS}
      // Only `schema`: its clear is otherwise inexpressible (see RevertModal).
      // The other fields here are all `.optional()` on the PUT validator, so a
      // null would be rejected in middleware rather than honoured.
      clearableFields={["schema"]}
      apiPathBase="/configs"
      renderDraftSelector={({
        mode,
        setMode,
        canAutoPublish,
        approvalRequired,
      }) => (
        <RevisionDraftSelectorForChanges
          entityId={config.id}
          openRevisions={[]}
          allRevisions={rest.allRevisions}
          mode={mode}
          setMode={setMode}
          selectedDraftId={null}
          setSelectedDraftId={() => undefined}
          canAutoPublish={canAutoPublish}
          approvalRequired={approvalRequired}
          hideExisting
          defaultExpanded
          triggerPrefix="Revert will be"
        />
      )}
      {...rest}
    />
  );
}
