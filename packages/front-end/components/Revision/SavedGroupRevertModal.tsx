import { Revision } from "shared/enterprise";
import { SavedGroupInterface } from "shared/types/saved-group";
import SavedGroupDraftSelectorForChanges from "@/components/SavedGroups/SavedGroupDraftSelectorForChanges";
import { RevisionDiffConfig } from "./useRevisionDiff";
import RevertModal from "./RevertModal";

// Fields a saved-group revert can restore (mirrors the live + ops merge
// semantics — `archived` is handled separately via an explicit opt-in).
const REVERTABLE_FIELDS = [
  "groupName",
  "owner",
  "values",
  "condition",
  "description",
  "projects",
] as const satisfies readonly (keyof SavedGroupInterface)[];

export interface Props {
  savedGroup: SavedGroupInterface;
  revision: Revision;
  allRevisions: Revision[];
  diffConfig: RevisionDiffConfig<SavedGroupInterface>;
  revertsBypassApproval: boolean;
  approvalRequired: boolean;
  canBypassApproval: boolean;
  close: () => void;
  onRevisionCreated: (revision: Revision) => void;
}

// Thin wrapper around the entity-agnostic RevertModal.
export default function SavedGroupRevertModal({ savedGroup, ...rest }: Props) {
  return (
    <RevertModal<SavedGroupInterface>
      liveEntity={savedGroup}
      revertableFields={REVERTABLE_FIELDS}
      apiPathBase="/saved-groups"
      renderDraftSelector={({
        mode,
        setMode,
        canAutoPublish,
        approvalRequired,
      }) => (
        <SavedGroupDraftSelectorForChanges
          savedGroup={savedGroup}
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
