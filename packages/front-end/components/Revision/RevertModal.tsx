import { ReactNode, useMemo, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import {
  Revision,
  applyTopLevelPatchOps,
  getLiveRevision,
  getRevisionNumberById,
} from "shared/enterprise";
import { dateNoYear } from "shared/dates";
import { useAuth } from "@/services/auth";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Field from "@/components/Forms/Field";
import Text from "@/ui/Text";
import Heading from "@/ui/Heading";
import Callout from "@/ui/Callout";
import Checkbox from "@/ui/Checkbox";
import { DraftMode } from "@/components/DraftSelector";
import SharedRevisionDropdown, {
  RevisionDropdownRow,
} from "@/components/Reviews/RevisionDropdown";
import { getStatusBadge } from "@/components/Revision/revisionUtils";
import { useUser } from "@/services/UserContext";
import { useRevisionDiff, RevisionDiffConfig } from "./useRevisionDiff";
import { RevisionDiff } from "./RevisionDiff";

// Entities the revert flow supports carry an `archived` flag (optional) that is
// handled separately from the generic revertable fields.
type RevertableEntity = { id: string; archived?: boolean };

export interface Props<T extends RevertableEntity> {
  // The live entity (the revert target's "before" state).
  liveEntity: T;
  // Fields a revert can restore (mirrors the live + ops merge semantics).
  // `archived` is handled separately via an explicit opt-in.
  revertableFields: readonly (keyof T)[];
  // PUT endpoint base for the entity (e.g. "/saved-groups", "/constants").
  apiPathBase: string;
  // The revision the revert was triggered from — the default "Reverting to".
  revision: Revision;
  allRevisions: Revision[];
  diffConfig: RevisionDiffConfig<T>;
  // Org allows reverts to skip approval (defaults the modal to publishing).
  revertsBypassApproval: boolean;
  // Org requires approval for changes to this entity.
  approvalRequired: boolean;
  // Viewer can bypass approval (admin) — can publish a revert even when the
  // org doesn't allow reverts to bypass approval.
  canBypassApproval: boolean;
  // Renders the entity's DraftSelectorForChanges (publish-now vs. create-draft
  // picker). Supplied by the thin per-entity wrappers so the revert modal reuses
  // the same component features use, instead of re-implementing the control.
  renderDraftSelector: (opts: {
    mode: DraftMode;
    setMode: (m: DraftMode) => void;
    canAutoPublish: boolean;
    approvalRequired: boolean;
  }) => ReactNode;
  close: () => void;
  onRevisionCreated: (revision: Revision) => void;
}

// Entity-agnostic analogue of the feature RevertModal
// (components/Reviews/Feature/RevertModal.tsx): pick a previously-published
// revision to restore, preview the diff against the live entity, optionally
// add a comment, and either publish immediately or create a revert draft.
// Thin per-entity wrappers (SavedGroupRevertModal, ConstantRevertModal) supply
// the entity-specific revertable fields, API path, and diff config.
export default function RevertModal<T extends RevertableEntity>({
  liveEntity,
  revertableFields,
  apiPathBase,
  revision,
  allRevisions,
  diffConfig,
  revertsBypassApproval,
  approvalRequired,
  canBypassApproval,
  renderDraftSelector,
  close,
  onRevisionCreated,
}: Props<T>) {
  const { apiCall } = useAuth();
  const { getUserDisplay } = useUser();

  // Revision-number map (stored version, else position by creation date) so
  // the dropdown and revert title read like the rest of the page.
  const revisionNumberById = useMemo(
    () => getRevisionNumberById(allRevisions),
    [allRevisions],
  );

  // Published (merged) revisions you can revert to, newest-published first.
  // The live revision (latest merged) is excluded — reverting to it is a no-op.
  const targetRevisions = useMemo(() => {
    const liveId = getLiveRevision(allRevisions)?.id;
    return [...allRevisions]
      .filter((r) => r.status === "merged" && r.id !== liveId)
      .sort(
        (a, b) =>
          new Date(b.dateUpdated).getTime() - new Date(a.dateUpdated).getTime(),
      );
  }, [allRevisions]);

  const [targetId, setTargetId] = useState<string>(() => {
    const inList = targetRevisions.some((r) => r.id === revision.id);
    return inList ? revision.id : (targetRevisions[0]?.id ?? revision.id);
  });

  const targetRevision =
    targetRevisions.find((r) => r.id === targetId) ?? revision;

  const targetState = useMemo(
    () =>
      applyTopLevelPatchOps(
        targetRevision.target.snapshot as unknown as T,
        targetRevision.target.proposedChanges,
      ) as unknown as T,
    [targetRevision],
  );

  const { diffs, badges, customRenderGroups } = useRevisionDiff<T>(
    liveEntity,
    targetState,
    diffConfig,
  );

  // Archive drift: only offer to flip `archived` when it differs from live.
  const targetArchived = !!targetState.archived;
  const liveArchived = !!liveEntity.archived;
  const archiveDrifts = targetArchived !== liveArchived;
  const willUnarchive = archiveDrifts && liveArchived && !targetArchived;
  // Default the opt-in to the recovery direction (un-archive), opt-in for the
  // more disruptive re-archive direction.
  const [includeArchive, setIncludeArchive] = useState<boolean>(
    () => archiveDrifts && liveArchived && !targetArchived,
  );

  // Reverts restore an already-reviewed state, so when the org allows it (or
  // doesn't require approval at all, or the viewer is an admin who can bypass)
  // the modal defaults to publishing; the draft option stays available for
  // those who still want a review step. Mirrors the feature RevertModal's
  // `canAutoPublish` gate.
  const canPublishNow =
    !approvalRequired || revertsBypassApproval || canBypassApproval;
  // Effective approval requirement for THIS revert. When the org lets reverts
  // bypass approval, publishing the revert isn't bypassing anything — so the
  // picker shows a plain "Publish now" instead of the red "Bypass approvals and
  // publish now". Mirrors the feature revert's `effectiveApprovalsRequired`.
  const effectiveApprovalRequired = approvalRequired && !revertsBypassApproval;
  const [mode, setMode] = useState<DraftMode>(
    canPublishNow ? "publish" : "new",
  );

  const [comment, setComment] = useState("");

  const targetNumber = revisionNumberById.get(targetRevision.id);

  const targetRows: RevisionDropdownRow[] = targetRevisions.map((r) => ({
    key: r.id,
    version: revisionNumberById.get(r.id) ?? 1,
    title: r.title,
    meta: (
      <Text size="small" color="text-low" whiteSpace="nowrap">
        {getUserDisplay(r.authorId)}
        {r.dateUpdated && <> &middot; {dateNoYear(r.dateUpdated)}</>}
      </Text>
    ),
    badge: getStatusBadge(r.status),
  }));

  const publishNow = mode === "publish";

  const visibleDiffs = diffs.filter((d) => d.a !== d.b);

  return (
    <ModalStandard
      header="Revert"
      trackingEventModalType="revert-revision"
      open={true}
      close={close}
      closeCta="Cancel"
      cta={publishNow ? "Publish Now" : "Create Revert Draft"}
      size="lg"
      submit={async () => {
        // Diff the chosen target state against the live entity; only send the
        // fields that actually changed.
        const revertChanges: Record<string, unknown> = {};
        revertableFields.forEach((key) => {
          const targetValue = targetState[key];
          const currentValue = liveEntity[key];
          if (JSON.stringify(targetValue) !== JSON.stringify(currentValue)) {
            revertChanges[key as string] = targetValue;
          }
        });
        if (archiveDrifts && includeArchive) {
          revertChanges.archived = targetArchived;
        }

        const sourceTitle =
          targetRevision.title?.trim() ||
          `Revision ${targetNumber ?? ""}`.trim();
        const title = `Revert to "${sourceTitle}"`;

        const params = new URLSearchParams({
          forceCreateRevision: "1",
          title,
          revertedFrom: targetRevision.id,
        });
        // Mirrors ArchiveModal: when approval is still required for this
        // revert and the caller can bypass it, record a bypass (for the audit
        // trail) instead of a plain auto-publish.
        if (publishNow) {
          if (effectiveApprovalRequired && canBypassApproval) {
            params.set("bypassApproval", "1");
          } else {
            params.set("autoPublish", "1");
          }
        }
        if (comment.trim()) params.set("comment", comment.trim());

        const res = await apiCall<{
          status: number;
          requiresApproval?: boolean;
          revision?: Revision;
        }>(`${apiPathBase}/${liveEntity.id}?${params.toString()}`, {
          method: "PUT",
          body: JSON.stringify(revertChanges),
        });

        if (res?.revision) onRevisionCreated(res.revision);
        close();
      }}
    >
      {renderDraftSelector({
        mode,
        setMode,
        canAutoPublish: canPublishNow,
        approvalRequired: effectiveApprovalRequired,
      })}

      <Heading as="h4" size="medium" mb="3">
        Review Changes
      </Heading>
      <Flex align="center" gap="2" mb="3" wrap="wrap">
        <Text weight="medium">Reverting to:</Text>
        <Box style={{ flex: 1, minWidth: 200, maxWidth: 480 }}>
          <SharedRevisionDropdown
            rows={targetRows}
            selectedKey={targetId}
            onSelect={(key) => setTargetId(key)}
            selectedBadge={getStatusBadge(targetRevision.status)}
            triggerPlaceholder="Select revision"
            triggerNumbered={false}
            menuPlacement="start"
          />
        </Box>
      </Flex>

      <Box className="appbox" p="4" mb="4">
        {visibleDiffs.length > 0 ? (
          <RevisionDiff
            diffs={visibleDiffs}
            badges={badges}
            customRenderGroups={customRenderGroups}
            variant="formatted"
          />
        ) : (
          <Text color="text-low">
            This revision matches the live state — nothing to revert.
          </Text>
        )}
      </Box>

      {archiveDrifts && (
        <Callout status="warning" mb="4">
          <Checkbox
            label={
              willUnarchive
                ? "Also un-archive (currently archived)"
                : "Also archive (currently active)"
            }
            value={includeArchive}
            setValue={setIncludeArchive}
          />
        </Callout>
      )}

      <Field
        label="Add a Comment (optional)"
        textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
      />
    </ModalStandard>
  );
}
