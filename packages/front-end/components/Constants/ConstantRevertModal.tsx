import { Revision } from "shared/enterprise";
import { ConstantInterface } from "shared/types/constant";
import RevertModal from "@/components/Revision/RevertModal";
import { RevisionDiffConfig } from "@/components/Revision/useRevisionDiff";
import ConstantDraftSelectorForChanges from "@/components/Constants/ConstantDraftSelectorForChanges";

// Fields a constant revert can restore (mirrors the live + ops merge
// semantics — `archived` is handled separately via an explicit opt-in).
const REVERTABLE_FIELDS = [
  "name",
  "owner",
  "description",
  "project",
  "value",
  "environmentValues",
] as const satisfies readonly (keyof ConstantInterface)[];

export interface Props {
  constant: ConstantInterface;
  revision: Revision;
  allRevisions: Revision[];
  diffConfig: RevisionDiffConfig<ConstantInterface>;
  revertsBypassApproval: boolean;
  approvalRequired: boolean;
  canBypassApproval: boolean;
  close: () => void;
  onRevisionCreated: (revision: Revision) => void;
}

// Thin wrapper around the entity-agnostic RevertModal.
export default function ConstantRevertModal({ constant, ...rest }: Props) {
  return (
    <RevertModal<ConstantInterface>
      liveEntity={constant}
      revertableFields={REVERTABLE_FIELDS}
      apiPathBase="/constants"
      renderDraftSelector={({
        mode,
        setMode,
        canAutoPublish,
        approvalRequired,
      }) => (
        <ConstantDraftSelectorForChanges
          constantId={constant.id}
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
