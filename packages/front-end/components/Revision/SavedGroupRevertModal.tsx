import { Revision, applyTopLevelPatchOps } from "shared/enterprise";
import { SavedGroupInterface } from "shared/types/saved-group";
import { ApiSavedGroupUpload } from "shared/validators";
import { useLingui } from "@lingui/react/macro";
import useApi from "@/hooks/useApi";
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
  "currentUploadVersion",
] as const satisfies readonly (keyof SavedGroupInterface)[];

export interface Props {
  savedGroup: SavedGroupInterface;
  revision: Revision;
  allRevisions: Revision[];
  diffConfig: RevisionDiffConfig<SavedGroupInterface>;
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
export default function SavedGroupRevertModal({ savedGroup, ...rest }: Props) {
  const { t } = useLingui();
  // The upload versions the revisions a revert can restore use
  const targetVersions = [
    ...new Set(
      rest.allRevisions.flatMap((r) => {
        const state = applyTopLevelPatchOps(
          r.target.snapshot,
          r.target.proposedChanges,
        );
        return "currentUploadVersion" in state &&
          state.currentUploadVersion !== undefined
          ? [state.currentUploadVersion]
          : [];
      }),
    ),
  ];
  // Deleted uploads aren't returned
  const { data: uploadsData } = useApi<{
    uploads: ApiSavedGroupUpload[];
    total: number;
  }>(
    `/saved-groups/${savedGroup.id}/uploads?limit=100&versions=${targetVersions.join(",")}`,
    { shouldRun: () => targetVersions.length > 0 },
  );

  // A remote group can only use a valid upload that still exists
  const getTargetProblem = (target: SavedGroupInterface) => {
    const version = target.currentUploadVersion;
    if (version === undefined || !uploadsData) return null;
    const { uploads, total } = uploadsData;
    const upload = uploads.find((u) => u.version === version);
    if (!upload) {
      // Past the first page of results, the server checks it on restore
      if (total > uploads.length) return null;
      return t`This revision uses upload version ${version}, which has been deleted, so it can't be restored.`;
    }
    return upload.status.type === "valid"
      ? null
      : t`This revision uses upload version ${version}, which isn't valid, so it can't be restored.`;
  };

  // A version can't be cleared, so reverting keeps the current one
  const currentVersion = savedGroup.currentUploadVersion;
  const getTargetWarning = (target: SavedGroupInterface) =>
    target.currentUploadVersion === undefined && currentVersion !== undefined
      ? t`This revision is from before the group used an upload. Reverting keeps upload version ${currentVersion}.`
      : null;

  return (
    <RevertModal<SavedGroupInterface>
      liveEntity={savedGroup}
      revertableFields={REVERTABLE_FIELDS}
      getTargetProblem={getTargetProblem}
      getTargetWarning={getTargetWarning}
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
          action="revert"
        />
      )}
      {...rest}
    />
  );
}
