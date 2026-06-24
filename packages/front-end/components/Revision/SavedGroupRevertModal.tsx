import { useMemo, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { Revision, applyTopLevelPatchOps } from "shared/enterprise";
import { SavedGroupInterface } from "shared/types/saved-group";
import { useAuth } from "@/services/auth";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Field from "@/components/Forms/Field";
import Text from "@/ui/Text";
import Heading from "@/ui/Heading";
import Callout from "@/ui/Callout";
import Checkbox from "@/ui/Checkbox";
import RadioGroup from "@/ui/RadioGroup";
import { Select, SelectItem } from "@/ui/Select";
import { useRevisionDiff, RevisionDiffConfig } from "./useRevisionDiff";
import { RevisionDiff } from "./RevisionDiff";

// Fields a saved-group revert can restore (mirrors the live + ops merge
// semantics — `archived` is handled separately via an explicit opt-in).
const REVERTABLE_FIELDS = [
  "groupName",
  "owner",
  "values",
  "condition",
  "description",
  "projects",
] as const;

export interface Props {
  // The live saved group (the revert target's "before" state).
  savedGroup: SavedGroupInterface;
  // The revision the revert was triggered from — the default "Reverting to".
  revision: Revision;
  allRevisions: Revision[];
  diffConfig: RevisionDiffConfig<SavedGroupInterface>;
  // Org allows reverts to skip approval (defaults the modal to publishing).
  revertsBypassApproval: boolean;
  // Org requires approval for saved-group changes.
  approvalRequired: boolean;
  // Viewer can bypass approval (admin) — can publish a revert even when the
  // org doesn't allow reverts to bypass approval.
  canBypassApproval: boolean;
  close: () => void;
  onRevisionCreated: (revision: Revision) => void;
}

// Saved-group analogue of the feature RevertModal
// (components/Reviews/Feature/RevertModal.tsx): pick a previously-published
// revision to restore, preview the diff against the live group, optionally
// add a comment, and either publish immediately or create a revert draft.
export default function SavedGroupRevertModal({
  savedGroup,
  revision,
  allRevisions,
  diffConfig,
  revertsBypassApproval,
  approvalRequired,
  canBypassApproval,
  close,
  onRevisionCreated,
}: Props) {
  const { apiCall } = useAuth();

  // Revision-number map (stored version, else position by creation date) so
  // the dropdown and revert title read like the rest of the page.
  const revisionNumberById = useMemo(() => {
    const sorted = [...allRevisions].sort(
      (a, b) =>
        new Date(a.dateCreated).getTime() - new Date(b.dateCreated).getTime(),
    );
    return new Map<string, number>(
      allRevisions.map((r) => [
        r.id,
        r.version ?? sorted.findIndex((s) => s.id === r.id) + 1,
      ]),
    );
  }, [allRevisions]);

  // Published (merged) revisions you can revert to, newest-published first.
  // The live revision (latest merged) is excluded — reverting to it is a no-op.
  const targetRevisions = useMemo(() => {
    const merged = [...allRevisions]
      .filter((r) => r.status === "merged")
      .sort(
        (a, b) =>
          new Date(b.dateUpdated).getTime() - new Date(a.dateUpdated).getTime(),
      );
    const liveId = merged[0]?.id;
    return merged.filter((r) => r.id !== liveId);
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
        targetRevision.target.snapshot as SavedGroupInterface,
        targetRevision.target.proposedChanges,
      ) as SavedGroupInterface,
    [targetRevision],
  );

  const { diffs, badges, customRenderGroups } =
    useRevisionDiff<SavedGroupInterface>(savedGroup, targetState, diffConfig);

  // Archive drift: only offer to flip `archived` when it differs from live.
  const targetArchived = !!targetState.archived;
  const liveArchived = !!savedGroup.archived;
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
  const [mode, setMode] = useState<"publish" | "new">(
    canPublishNow ? "publish" : "new",
  );

  const [comment, setComment] = useState("");

  const targetNumber = revisionNumberById.get(targetRevision.id);
  const targetOptions = targetRevisions.map((r) => {
    const num = revisionNumberById.get(r.id);
    return {
      value: r.id,
      label: r.title?.trim() || `Revision ${num ?? ""}`.trim(),
    };
  });

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
        // Diff the chosen target state against the live group; only send the
        // fields that actually changed.
        const revertChanges: Record<string, unknown> = {};
        REVERTABLE_FIELDS.forEach((key) => {
          const targetValue = targetState[key];
          const currentValue = savedGroup[key];
          if (JSON.stringify(targetValue) !== JSON.stringify(currentValue)) {
            revertChanges[key] = targetValue;
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
        if (publishNow) params.set("autoPublish", "1");
        if (comment.trim()) params.set("comment", comment.trim());

        const res = await apiCall<{
          status: number;
          requiresApproval?: boolean;
          revision?: Revision;
        }>(`/saved-groups/${savedGroup.id}?${params.toString()}`, {
          method: "PUT",
          body: JSON.stringify(revertChanges),
        });

        if (res?.revision) onRevisionCreated(res.revision);
        close();
      }}
    >
      {canPublishNow ? (
        <Box mb="4">
          <RadioGroup
            value={mode}
            setValue={(v) => setMode(v as "publish" | "new")}
            options={[
              {
                value: "publish",
                label: "Publish now",
                description:
                  "Restore the saved group to this revision immediately.",
              },
              {
                value: "new",
                label: "Create a revert draft",
                description: "Create a draft to review before it goes live.",
              },
            ]}
          />
        </Box>
      ) : (
        <Callout status="info" mb="4">
          Reverting will create a draft that needs to be reviewed and published
          before it goes live.
        </Callout>
      )}

      <Heading as="h4" size="medium" mb="3">
        Review Changes
      </Heading>
      <Flex align="center" gap="2" mb="3" wrap="wrap">
        <Text weight="medium">Reverting to:</Text>
        <Box style={{ flex: 1, minWidth: 200, maxWidth: 480 }}>
          <Select
            value={targetId}
            setValue={(value) => setTargetId(value)}
            style={{ width: "100%", maxWidth: "100%" }}
          >
            {targetOptions.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </Select>
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
            This revision matches the live saved group — nothing to revert.
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
