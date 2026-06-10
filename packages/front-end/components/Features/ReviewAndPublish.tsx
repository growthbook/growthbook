import { FeatureInterface } from "shared/types/feature";
import { useState, useMemo, useRef, useCallback } from "react";
import {
  RampScheduleInterface,
  ACTIVE_DRAFT_STATUSES,
} from "shared/validators";
import {
  FeatureRevisionInterface,
  MinimalFeatureRevisionInterface,
  RevisionLog,
} from "shared/types/feature-revision";
import {
  autoMerge,
  fillRevisionFromFeature,
  liveRevisionFromFeature,
  filterEnvironmentsByFeature,
  getAffectedEnvsForExperiment,
  getEnvsFromRampSchedule,
  mergeResultHasChanges,
  getReviewSetting,
  checkIfRevisionNeedsReview,
  evaluatePublishGovernance,
  getLiveChangesSinceBase,
  MergeStrategy,
} from "shared/util";
import {
  EventUserLoggedIn,
  EventUserApiKey,
} from "shared/types/events/event-types";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { FaArrowLeft } from "react-icons/fa";
import { PiLockSimple, PiGitMergeBold, PiCaretDownBold } from "react-icons/pi";
import { BsThreeDotsVertical } from "react-icons/bs";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { format } from "date-fns";
import EventUser from "@/components/Avatar/EventUser";
import { getCurrentUser, useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";
import useOrgSettings from "@/hooks/useOrgSettings";
import {
  getAffectedRevisionEnvs,
  useEnvironments,
  useFeatureExperimentChecklists,
} from "@/services/features";
import { getFutureScheduledStartDate } from "@/services/experiments";
import PagedModal from "@/components/Modal/PagedModal";
import Page from "@/components/Modal/Page";
import LinkButton from "@/components/Button";
import Revisionlog, { MutateLog } from "@/components/Features/RevisionLog";
import useApi from "@/hooks/useApi";
import RevisionLabel from "@/components/Features/RevisionLabel";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import {
  useFeatureRevisionDiff,
  featureToFeatureRevisionDiffInput,
  mergeResultToDiffInput,
  normalizeRevisionMetadata,
  FeatureRevisionDiffInput,
  FeatureRevisionDiff,
} from "@/hooks/useFeatureRevisionDiff";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import Heading from "@/ui/Heading";
import Badge from "@/ui/Badge";
import {
  revisionStatusBadgeVariant,
  revisionStatusColor,
  revisionStatusIcon,
  revisionStatusLabel,
} from "@/components/Features/RevisionStatusBadge";
import Callout from "@/ui/Callout";
import Checkbox from "@/ui/Checkbox";
import { useHoldouts } from "@/hooks/useHoldouts";
import { PreLaunchChecklistForDraft } from "@/components/Experiment/PreLaunchChecklist";
import { COMPACT_DIFF_STYLES } from "@/components/AuditHistoryExplorer/CompareAuditEventsUtils";
import {
  ExpandableDiff,
  ExpandableConflict,
  buildRampDiffs,
  DiffContent,
  RevisionCommentSection,
} from "@/components/Features/RevisionDiffUtils";
import DivergenceNotice from "@/components/Features/DivergenceNotice";
import HelperText from "@/ui/HelperText";
import ReviewCommentPopover from "@/components/Features/ReviewCommentPopover";
import CommentComposer from "@/components/Comments/CommentComposer";
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
} from "@/ui/DropdownMenu";
import RevertModal from "@/components/Features/RevertModal";
import { getReviewAndPublishState } from "@/components/Features/reviewAndPublishState";

export interface Props {
  // The base (live) feature.
  feature: FeatureInterface;
  revisions: FeatureRevisionInterface[];
  // Minimal revision list (up to 200) — used by the revert flow's dropdown.
  revisionList: MinimalFeatureRevisionInterface[];
  // The version currently selected in the URL (?v=). This is the single source
  // of truth for which revision the tab is reviewing: an active draft renders
  // the review/publish flow; any other status renders a read-only review.
  version: number;
  // Update the selected version (writes ?v= to the URL).
  setVersion: (version: number) => void;
  mutate: () => void;
  // Navigate away from the tab (e.g. back to Overview) after publishing or from
  // the empty state.
  onClose?: () => void;
  onPublish?: () => void;
  experiments?: ExperimentInterfaceStringDates[];
  rampSchedules?: RampScheduleInterface[];
}

// Compact contributor / reviewer row: small avatar on the left, name on the
// first line, email wrapping naturally on the second. Used in the narrow
// actions column where avatar-name-email inline rows overflow awkwardly.
function PersonRow({
  id,
  name,
  email,
  trailing,
}: {
  id: string;
  name: string;
  email: string;
  trailing?: React.ReactNode;
}) {
  const displayName = name || email || "Unknown";
  return (
    <Flex align="start" gap="2">
      <Box flexShrink="0" mt="1">
        <EventUser
          user={{ type: "dashboard", id, name, email }}
          display="avatar"
          size="sm"
        />
      </Box>
      <Box flexGrow="1" style={{ minWidth: 0, lineHeight: 1.3 }}>
        <Text size="small" color="text-high" as="div" overflowWrap="anywhere">
          {displayName}
        </Text>
        {name && email && (
          <Text size="small" color="text-low" as="div" overflowWrap="anywhere">
            {email}
          </Text>
        )}
      </Box>
      {trailing && <Box flexShrink="0">{trailing}</Box>}
    </Flex>
  );
}

// Compact verdict indicator for the Reviewers widget: the revision-status
// icon in a soft colored circle (same visual language as the timeline's
// inline events), with a tooltip spelling out the state.
function ReviewerVerdictIcon({
  status,
  name,
}: {
  status: "approved" | "changes-requested";
  name: string;
}) {
  const color = revisionStatusColor(status);
  const who = name || "This reviewer";
  const content =
    status === "approved"
      ? `${who} approved these changes`
      : `${who} requested changes`;
  return (
    <Tooltip content={content}>
      <Flex
        align="center"
        justify="center"
        style={{
          width: 24,
          height: 24,
          borderRadius: "50%",
          background: `var(--${color}-a3)`,
          color: `var(--${color}-11)`,
          fontSize: 14,
        }}
      >
        {revisionStatusIcon(status)}
      </Flex>
    </Tooltip>
  );
}

// The feature-page "Review and Publish" tab. Consolidates the former DraftModal
// (direct publish), RequestReviewModal (review lifecycle), and
// FeatureFixConflictsModal (rebase / conflict resolution) into a single page
// surface. Conflict resolution and review submission run as focused modals
// launched from the page. CTA/routing decisions come from
// getReviewAndPublishState; the divergence/stale-approval governance comes from
// evaluatePublishGovernance.
export default function ReviewAndPublish({
  feature,
  version,
  setVersion,
  revisions,
  revisionList,
  mutate,
  onClose,
  onPublish,
  experiments: experimentsList,
  rampSchedules,
}: Props) {
  const allEnvironments = useEnvironments();
  const environments = filterEnvironmentsByFeature(allEnvironments, feature);
  const envIds = environments.map((e) => e.id);
  const permissionsUtil = usePermissionsUtil();
  const { apiCall } = useAuth();
  const user = getCurrentUser();
  const {
    users,
    hasCommercialFeature,
    userId,
    name: userName,
    email: userEmail,
  } = useUser();
  const settings = useOrgSettings();
  const { holdoutsMap } = useHoldouts();

  // The tab is driven entirely by the selected version (?v= in the URL). The
  // header's RevisionDropdown determines which revision we're reviewing; this
  // component never silently substitutes a different draft.
  const revision = revisions.find((r) => r.version === version) ?? null;
  const isActiveDraft =
    !!revision &&
    (ACTIVE_DRAFT_STATUSES as readonly string[]).includes(revision.status);
  const isLive = !!revision && revision.version === feature.version;
  const baseRevision = revisions.find(
    (r) => r.version === revision?.baseVersion,
  );
  const liveRevision = revisions.find((r) => r.version === feature.version);

  // ── Reviewers (per-user latest verdict) ──
  // Pull the revision log (SWR-deduped against <Revisionlog>'s own fetch) and
  // aggregate the most recent Approved/Requested Changes entry per user. A
  // plain Comment is not a verdict so we don't surface it as a review status.
  // Must be called before any early returns to keep hook order stable.
  const { data: logData, mutate: mutateReviewLog } = useApi<{
    log: RevisionLog[];
  }>(
    revision
      ? `/feature/${feature.id}/${revision.version}/log`
      : `/feature/${feature.id}/0/log`,
    { shouldRun: () => !!revision },
  );
  const reviewers = useMemo<
    { id: string; status: "approved" | "changes-requested" }[]
  >(() => {
    const log = logData?.log;
    if (!log) return [];
    // Replay the lifecycle chronologically so retractions (Undo Review by
    // the reviewer) and recalls (Recall Review by the author) properly
    // invalidate prior verdicts. Without this, a reviewer who pulls back
    // their approval would still appear listed with the stale verdict.
    const sorted = [...log].sort((a, b) =>
      (a.timestamp as unknown as string).localeCompare(
        b.timestamp as unknown as string,
      ),
    );
    const byUser = new Map<string, "approved" | "changes-requested">();
    for (const entry of sorted) {
      if (entry.action === "Review Requested") {
        // New cycle wipes prior verdicts.
        byUser.clear();
        continue;
      }
      if (entry.action === "Recall Review") {
        // Author pulled the request — all in-flight verdicts no longer count.
        byUser.clear();
        continue;
      }
      const uid = entry.user && "id" in entry.user ? entry.user.id : undefined;
      if (!uid) continue;
      if (entry.action === "Approved") {
        byUser.set(uid, "approved");
      } else if (entry.action === "Requested Changes") {
        byUser.set(uid, "changes-requested");
      } else if (entry.action === "Undo Review") {
        byUser.delete(uid);
      }
    }
    return Array.from(byUser, ([id, status]) => ({ id, status }));
  }, [logData]);

  // User ID of whoever most recently submitted a "Review Requested" entry.
  // Used to gate "Retract review request" so only the requester sees it.
  const reviewRequesterId = useMemo<string | undefined>(() => {
    const log = logData?.log;
    if (!log) return undefined;
    const sorted = [...log].sort((a, b) =>
      (b.timestamp as unknown as string).localeCompare(
        a.timestamp as unknown as string,
      ),
    );
    for (const entry of sorted) {
      if (entry.action !== "Review Requested") continue;
      const uid = entry.user && "id" in entry.user ? entry.user.id : undefined;
      if (uid) return uid;
    }
    return undefined;
  }, [logData]);
  // --- Read-only review (selected version is not an active draft) ----------
  const [revertOpen, setRevertOpen] = useState(false);
  const [confirmReopen, setConfirmReopen] = useState(false);
  const liveBaseInput = useMemo(
    () => featureToFeatureRevisionDiffInput(feature),
    [feature],
  );
  const toDiffInput = useCallback(
    (r: FeatureRevisionInterface): FeatureRevisionDiffInput => ({
      defaultValue: r.defaultValue,
      rules: Array.isArray(r.rules) ? r.rules : [],
      environmentsEnabled:
        r.environmentsEnabled ?? liveBaseInput.environmentsEnabled,
      prerequisites: r.prerequisites ?? liveBaseInput.prerequisites,
      archived: r.archived ?? liveBaseInput.archived,
      holdout:
        r.holdout !== undefined ? r.holdout : (liveBaseInput.holdout ?? null),
      metadata: normalizeRevisionMetadata(r.metadata) ?? liveBaseInput.metadata,
      rampActions: r.rampActions ?? undefined,
    }),
    [liveBaseInput],
  );
  // Read-only diff: the selected (published/live) revision vs. the revision it
  // was based on, i.e. the changes this revision introduced when published.
  const readonlyBaseRevision = revisions.find(
    (r) => r.version === revision?.baseVersion,
  );
  const readonlyBeforeInput = readonlyBaseRevision
    ? toDiffInput(readonlyBaseRevision)
    : liveBaseInput;
  const readonlyAfterInput = revision ? toDiffInput(revision) : liveBaseInput;
  const readonlyDiffs = useFeatureRevisionDiff({
    current: readonlyBeforeInput,
    draft: readonlyAfterInput,
  });
  // The previously-published revision to roll back to when viewing the live one.
  const previousPublishedRevision = useMemo(() => {
    const live = revisions.find((r) => r.version === feature.version);
    const livePublishedAt = live?.datePublished
      ? new Date(live.datePublished).getTime()
      : Infinity;
    return (
      revisions
        .filter(
          (r) =>
            r.status === "published" &&
            r.version !== feature.version &&
            !!r.datePublished &&
            new Date(r.datePublished).getTime() < livePublishedAt,
        )
        .sort((a, b) => {
          const bt = b.datePublished ? new Date(b.datePublished).getTime() : 0;
          const at = a.datePublished ? new Date(a.datePublished).getTime() : 0;
          return bt - at;
        })[0] ?? null
    );
  }, [revisions, feature.version]);

  const [strategies, setStrategies] = useState<Record<string, MergeStrategy>>(
    {},
  );
  const [conflictStep, setConflictStep] = useState(0);
  const [resolveConflicts, setResolveConflicts] = useState(false);
  // Revision notes, sent along with request-review/publish submissions.
  // Derived (not state): notes are edited via the inline Notes composer which
  // persists directly to the API and mutates the revision.
  const comment = revision?.comment || "";
  const [adminPublish, setAdminPublish] = useState(false);
  const [rebasing, setRebasing] = useState(false);
  const [experimentsStep, setExperimentsStep] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [secondaryLoading, setSecondaryLoading] = useState<
    "recall" | "undo" | null
  >(null);
  const [secondaryError, setSecondaryError] = useState<string | null>(null);
  const [actionsDropdownOpen, setActionsDropdownOpen] = useState(false);
  const revisionLogRef = useRef<MutateLog>(null);

  const mergeResult = useMemo(() => {
    if (!revision || !baseRevision || !liveRevision) return null;
    return autoMerge(
      liveRevisionFromFeature(liveRevision, feature),
      fillRevisionFromFeature(baseRevision, feature),
      revision,
      envIds,
      strategies,
    );
  }, [revision, baseRevision, liveRevision, envIds, strategies, feature]);

  const canAdminPublish = permissionsUtil.canBypassApprovalChecks(feature);
  const featureLockedByRamp =
    rampSchedules?.some(
      (rs) => rs.lockdownConfig?.mode === "locked" && rs.status === "running",
    ) ?? false;

  const isPendingReview =
    revision?.status === "pending-review" ||
    revision?.status === "changes-requested";
  const createdBy = revision?.createdBy as
    | EventUserLoggedIn
    | EventUserApiKey
    | undefined;
  const requireReviewSettings = settings?.requireReviews;
  const reviewSetting = Array.isArray(requireReviewSettings)
    ? getReviewSetting(requireReviewSettings, feature)
    : undefined;
  const isBlockedContributor =
    reviewSetting?.blockSelfApproval &&
    (revision?.contributors ?? []).some((id) => id === user?.id);
  const canReview =
    !!isPendingReview &&
    createdBy?.id !== user?.id &&
    permissionsUtil.canReviewFeatureDrafts(feature);
  const approved = revision?.status === "approved" || adminPublish;

  const liveChanges = useMemo(() => {
    if (!liveRevision || !baseRevision) return [];
    return getLiveChangesSinceBase(
      liveRevisionFromFeature(liveRevision, feature),
      fillRevisionFromFeature(baseRevision, feature),
      envIds,
    );
  }, [liveRevision, baseRevision, feature, envIds]);

  const governance = useMemo(() => {
    if (!revision || !mergeResult) return null;
    return evaluatePublishGovernance({
      revisionStatus: revision.status,
      baseVersion: revision.baseVersion,
      liveVersion: feature.version,
      mergeSuccess: mergeResult.success,
      liveChanges,
      approvedBaseVersion: revision.approvedBaseVersion ?? null,
      requireRebaseBeforePublish: !!settings?.requireRebaseBeforePublish,
    });
  }, [revision, mergeResult, feature.version, liveChanges, settings]);

  const experimentsMap = useMemo<
    Map<string, ExperimentInterfaceStringDates>
  >(() => {
    if (!experimentsList) return new Map();
    return new Map(experimentsList.map((exp) => [exp.id, exp]));
  }, [experimentsList]);

  const { experiments, immediateStartExperiments, scheduledExperiments } =
    useFeatureExperimentChecklists({
      feature,
      revision: revision ?? undefined,
      experimentsMap,
    });

  const [selectedExperiments, setSelectedExperiments] = useState(
    new Set(experiments.map((e) => e.id)),
  );

  const selectedImmediateCount = immediateStartExperiments.filter((e) =>
    selectedExperiments.has(e.id),
  ).length;
  const selectedScheduledCount = scheduledExperiments.filter((e) =>
    selectedExperiments.has(e.id),
  ).length;
  const onlyScheduledSelected =
    selectedImmediateCount === 0 && selectedScheduledCount > 0;

  const checklistStateRef = useRef<
    Map<string, { failedRequired: boolean; loading: boolean }>
  >(new Map());
  const [checklistBlocked, setChecklistBlocked] = useState(false);
  const handleChecklistReady = useCallback(
    (expId: string, failedRequired: boolean, loading: boolean) => {
      checklistStateRef.current.set(expId, { failedRequired, loading });
      setChecklistBlocked(
        [...checklistStateRef.current.values()].some(
          (v) => v.failedRequired || v.loading,
        ),
      );
    },
    [],
  );

  const currentRevisionData = featureToFeatureRevisionDiffInput(feature);
  const draftDiffInput = mergeResult?.success
    ? mergeResultToDiffInput(mergeResult.result, currentRevisionData)
    : currentRevisionData;
  const resultDiffs = useFeatureRevisionDiff({
    current: currentRevisionData,
    draft: draftDiffInput,
  });
  // `draftDiffInput` intentionally omits fields the merge didn't touch (its
  // presence semantics drive the sectional diff above). For the whole-object
  // "Raw JSON" view we need a complete object, otherwise unchanged fields look
  // like deletions — so layer the merged changes over the current revision.
  const draftRawAfter = { ...currentRevisionData, ...draftDiffInput };

  const rampDiffs = useMemo(
    () =>
      revision
        ? buildRampDiffs({ feature, revision, rampSchedules, holdoutsMap })
        : [],
    [feature, revision, rampSchedules, holdoutsMap],
  );

  const onUpdateFromLive = async () => {
    if (!revision || !mergeResult?.success) return;
    setRebasing(true);
    try {
      await apiCall(`/feature/${feature.id}/${revision.version}/rebase`, {
        method: "POST",
        body: JSON.stringify({
          mergeResultSerialized: JSON.stringify(mergeResult),
          strategies: {},
        }),
      });
      await mutate();
    } finally {
      setRebasing(false);
    }
  };

  const pageWrapper = (children: React.ReactNode) => (
    <Box className="contents container-fluid pagecontents pt-4">{children}</Box>
  );

  // The selected version doesn't exist yet (still loading) or ?v= is invalid.
  if (!revision) {
    return pageWrapper(
      <Callout status="info">
        Select a revision from the dropdown above to review.
        {onClose && (
          <Box mt="2">
            <Button variant="soft" onClick={() => onClose()}>
              Back to Overview
            </Button>
          </Box>
        )}
      </Callout>,
    );
  }

  // ── Shared left column (both the draft flow and the read-only review):
  // notes + full diffs, followed by the lifecycle/audit timeline and the
  // comment composer. ──
  const renderLeftColumn = (
    diffs: FeatureRevisionDiff[],
    raw: { before: unknown; after: unknown },
  ) => (
    <>
      <RevisionCommentSection
        featureId={feature.id}
        versions={[
          {
            version: revision.version,
            revisionComment: revision.comment,
            title: revision.title,
          },
        ]}
        isDraft={isActiveDraft}
        canEdit={permissionsUtil.canManageFeatureDrafts(feature)}
        onSaved={mutate}
      />

      <Box className="appbox" mb="0">
        <DiffContent
          diffs={diffs}
          feature={feature}
          outOfOrderWarning={false}
          raw={raw}
          variant="card"
        />
      </Box>

      {/* The timeline's vertical line runs straight out of the bottom of
            the summary card above (no gap, no separator). */}
      <Box mb="4">
        <Revisionlog
          feature={feature}
          revision={revision}
          ref={revisionLogRef}
          onRevisionMutate={mutate}
        />

        {/* Composer sits below the timeline — entries are chronological
              (newest at the bottom), so new comments appear right above it.
              Your avatar + an "Add a comment" header sit above the input,
              aligned with the timeline's comment cards. */}
        {isActiveDraft && (
          <Flex align="start" gap="3" mt="4">
            <Box flexShrink="0">
              <EventUser
                user={{
                  type: "dashboard",
                  id: userId || "",
                  name: userName || "",
                  email: userEmail || "",
                }}
                display="avatar"
                size="sm"
              />
            </Box>
            <Box flexGrow="1" style={{ minWidth: 0 }}>
              {/* Fixed-height row matching the 24px sm avatar so the label
                    centers against it */}
              <Flex align="center" style={{ height: 24 }}>
                <Heading as="h4" size="small" mb="0">
                  Add a comment
                </Heading>
              </Flex>
              <CommentComposer
                placeholder="Leave a comment…"
                onSubmit={async (comment) => {
                  await apiCall(
                    `/feature/${feature.id}/${revision.version}/comment`,
                    {
                      method: "POST",
                      body: JSON.stringify({ comment }),
                    },
                  );
                  await revisionLogRef.current?.mutateLog();
                }}
              />
            </Box>
          </Flex>
        )}
      </Box>
    </>
  );

  // Contributor IDs (author + everyone whose edits touched the revision).
  // Hoisted above the read-only branch so both the draft flow and the
  // read-only column can render the same Contributors / Reviewers widgets.
  const authorId =
    revision.createdBy && "id" in revision.createdBy && revision.createdBy.id
      ? revision.createdBy.id
      : undefined;
  const contribIds = revision.contributors ?? [];
  const contributorIds =
    authorId && !contribIds.includes(authorId)
      ? [authorId, ...contribIds]
      : contribIds;

  // Read-only review: the selected version is not an active draft. Same
  // two-column layout as the draft flow, but the actions column offers the
  // status-appropriate primary action instead of the review/publish flow:
  // "Roll back" (live), "Revert to this revision" (previously published), or
  // "Reopen as draft" (discarded).
  if (!isActiveDraft) {
    const revertTarget = isLive
      ? previousPublishedRevision
      : revision.status === "published"
        ? revision
        : null;
    const canManageDrafts = permissionsUtil.canManageFeatureDrafts(feature);
    const canRevert = canManageDrafts && !!revertTarget;
    const isDiscarded = revision.status === "discarded";
    // Same page header as the draft path, but the summary line describes
    // the terminal state (merged/published, live, or discarded) instead of a
    // pending merge.
    const status = isLive ? "live" : revision.status;
    const statusColor = revisionStatusColor(status);
    const headerTitle =
      revision.title?.trim() ||
      revision.comment?.trim() ||
      `Revision ${revision.version}`;
    const baseV = readonlyBaseRevision?.version;
    const publishedDate = revision.datePublished
      ? format(new Date(revision.datePublished), "MMM d, yyyy")
      : null;
    const discardedDate = revision.dateUpdated
      ? format(new Date(revision.dateUpdated), "MMM d, yyyy")
      : null;

    // Errors surface inside the confirm modal via ModalForm's error handling.
    const doReopen = async () => {
      await apiCall(`/feature/${feature.id}/${revision.version}/reopen`, {
        method: "POST",
      });
      await mutate();
    };

    const readonlyHeader = (
      <Box mb="6">
        <Heading as="h3" size="large" mb="2">
          {headerTitle}
        </Heading>
        <Flex align="center" gap="2">
          <Box style={{ flexShrink: 0 }}>
            <Badge
              size="lg"
              variant={revisionStatusBadgeVariant(status)}
              radius="full"
              color={statusColor}
              label={revisionStatusLabel(status)}
            />
          </Box>
          <Text as="span" color="text-low">
            {isDiscarded ? (
              <>
                Revision <strong>{revision.version}</strong>
                {baseV != null ? <> (based on revision {baseV})</> : null} was
                discarded{discardedDate ? ` on ${discardedDate}` : ""}
              </>
            ) : (
              <>
                Revision <strong>{revision.version}</strong>
                {baseV != null ? (
                  <>
                    {" "}
                    was merged into revision <strong>{baseV}</strong> and
                    published
                  </>
                ) : (
                  <> was published</>
                )}
                {publishedDate ? ` on ${publishedDate}` : ""}
              </>
            )}
          </Text>
        </Flex>
      </Box>
    );

    const readonlyActionsColumn = (
      <Box
        className="appbox"
        style={{ position: "sticky", top: 90, overflow: "hidden" }}
      >
        {/* Status header – colored tint matching the revision badge */}
        <Flex
          align="center"
          px="4"
          style={{
            background: `var(--${statusColor}-a3)`,
            borderBottom: "1px solid var(--gray-a4)",
            minHeight: 40,
          }}
        >
          <Flex
            align="center"
            gap="2"
            style={{ color: `var(--${statusColor}-11)` }}
          >
            <Box style={{ fontSize: 14, lineHeight: 1, display: "flex" }}>
              {revisionStatusIcon(status)}
            </Box>
            <Heading as="h4" size="small">
              <span style={{ color: `var(--${statusColor}-11)` }}>
                {revisionStatusLabel(status)}
              </span>
            </Heading>
          </Flex>
        </Flex>

        <Box p="4">
          {/* People: same widgets as the draft flow. Useful on locked / live
              / discarded revisions for attribution and audit context. */}
          {contributorIds.length > 0 && (
            <Box mb="3">
              <Text
                size="medium"
                weight="medium"
                color="text-high"
                as="div"
                mb="2"
              >
                Contributors
              </Text>
              <Flex direction="column" gap="2">
                {contributorIds.map((id) => {
                  const u = users.get(id);
                  return (
                    <PersonRow
                      key={id}
                      id={id}
                      name={u?.name || ""}
                      email={u?.email || ""}
                    />
                  );
                })}
              </Flex>
            </Box>
          )}

          {reviewers.length > 0 && (
            <Box mb="3">
              <Text
                size="medium"
                weight="medium"
                color="text-high"
                as="div"
                mb="2"
              >
                Reviewers
              </Text>
              <Flex direction="column" gap="2">
                {reviewers.map(({ id, status }) => {
                  const u = users.get(id);
                  return (
                    <PersonRow
                      key={id}
                      id={id}
                      name={u?.name || ""}
                      email={u?.email || ""}
                      trailing={
                        <ReviewerVerdictIcon
                          status={status}
                          name={u?.name || u?.email || ""}
                        />
                      }
                    />
                  );
                })}
              </Flex>
            </Box>
          )}

          <Box mt="5" mb="4">
            <HelperText status="info" size="sm">
              {isDiscarded ? (
                <>
                  This revision was discarded. Reopen it as a draft to continue
                  editing, request review, and publish.
                </>
              ) : isLive ? (
                <>
                  This revision is currently live. Rolling back reverts the
                  feature to the previously published revision.
                </>
              ) : (
                <>
                  This revision was published and is now locked. You can revert
                  the feature back to this revision.
                </>
              )}
            </HelperText>
          </Box>

          {isDiscarded ? (
            <Button
              onClick={() => setConfirmReopen(true)}
              disabled={!canManageDrafts}
              style={{ width: "100%" }}
            >
              Reopen as draft
            </Button>
          ) : (
            <Button
              color="red"
              variant="outline"
              onClick={() => setRevertOpen(true)}
              disabled={!canRevert}
              style={{ width: "100%" }}
            >
              {isLive ? "Roll back" : "Revert to this revision"}
            </Button>
          )}

          {!canManageDrafts && (
            <HelperText status="info" size="md" mt="5">
              You don&apos;t have permission to manage drafts for this feature.
            </HelperText>
          )}
          {!isDiscarded && canManageDrafts && !revertTarget && (
            <HelperText status="info" size="md" mt="5">
              There is no previously published revision to roll back to.
            </HelperText>
          )}
        </Box>
      </Box>
    );

    return pageWrapper(
      <>
        {revertOpen && revertTarget && (
          <RevertModal
            feature={feature}
            revision={revertTarget}
            revisionList={revisionList}
            allRevisions={revisions}
            close={() => setRevertOpen(false)}
            mutate={mutate}
            setVersion={setVersion}
          />
        )}
        {confirmReopen && (
          <ModalStandard
            trackingEventModalType="reopen-feature-revision"
            open={true}
            header="Reopen Revision"
            cta="Reopen"
            close={() => setConfirmReopen(false)}
            submit={doReopen}
          >
            This will reopen the revision and allow you to make further changes
            or request review again.
          </ModalStandard>
        )}
        {readonlyHeader}
        <Flex gap="5" align="start">
          <Box style={{ flex: 1, minWidth: 0 }}>
            {renderLeftColumn(readonlyDiffs, {
              before: readonlyBeforeInput,
              after: readonlyAfterInput,
            })}
          </Box>
          <Box style={{ width: 360, minWidth: 360, flexShrink: 0 }}>
            {readonlyActionsColumn}
          </Box>
        </Flex>
      </>,
    );
  }

  // Active draft, but the merge baseline hasn't loaded yet (rare).
  if (!mergeResult) {
    return pageWrapper(<Callout status="info">Loading draft changes…</Callout>);
  }

  const allDiffs = [...resultDiffs, ...rampDiffs];
  const hasChanges = mergeResultHasChanges(mergeResult) || rampDiffs.length > 0;
  const linkedRamps = (rampSchedules ?? []).filter(
    (r) =>
      r.status === "pending" &&
      r.targets.some(
        (t) =>
          t.entityId === feature.id &&
          t.activatingRevisionVersion === revision.version,
      ),
  );

  const hasPublishPermission = permissionsUtil.canPublishFeature(
    feature,
    getAffectedRevisionEnvs(feature, revision, environments),
  );

  // Determine whether approvals are required by diffing the merged result
  // against live (mirrors the feature overview's gating calculation).
  let requireReviews = false;
  if (baseRevision) {
    const filledBaseRevision = {
      ...baseRevision,
      ...fillRevisionFromFeature(baseRevision, feature),
    };
    const filledRevision = {
      ...revision,
      ...fillRevisionFromFeature(revision, feature),
    };
    let effectiveRevision: typeof filledRevision = filledRevision;
    let effectiveBase: typeof filledBaseRevision = filledBaseRevision;
    if (mergeResult.success && liveRevision) {
      const filledLive = {
        ...liveRevision,
        ...liveRevisionFromFeature(liveRevision, feature),
      };
      effectiveRevision = {
        ...filledLive,
        ...mergeResult.result,
        rules: mergeResult.result.rules ?? filledLive.rules,
        rampActions: revision.rampActions,
      };
      effectiveBase = filledLive;
    }
    requireReviews = checkIfRevisionNeedsReview({
      feature,
      baseRevision: effectiveBase,
      revision: effectiveRevision,
      allEnvironments: envIds,
      settings,
      requireApprovalsLicensed: hasCommercialFeature("require-approvals"),
      liveRampScheduleEnvs: (() => {
        const map = new Map<string, string[] | "all">();
        for (const action of effectiveRevision.rampActions ?? []) {
          if (action.mode !== "update") continue;
          const liveSchedule = rampSchedules?.find(
            (rs) => rs.id === action.rampScheduleId,
          );
          if (liveSchedule) {
            map.set(
              action.rampScheduleId,
              getEnvsFromRampSchedule(liveSchedule),
            );
          }
        }
        return map;
      })(),
    });
  }

  const state = getReviewAndPublishState({
    requireReviews,
    status: revision.status,
    mergeSuccess: mergeResult.success,
    hasChanges,
    hasReviewPermission: permissionsUtil.canReviewFeatureDrafts(feature),
    canManageDraft: permissionsUtil.canManageFeatureDrafts(feature),
    isReviewRequester:
      !!userId && !!reviewRequesterId && userId === reviewRequesterId,
    isReviewer: !!userId && reviewers.some((r) => r.id === userId),
    adminPublish,
    hasSelectedExperiments: selectedExperiments.size > 0,
    onlyScheduledSelected,
    experimentsStep,
    featureLockedByRamp,
    checklistBlocked,
    governanceCanPublish: governance ? governance.canPublish : true,
  });

  const doSubmit = async () => {
    setSubmitError(null);
    try {
      switch (state.submitAction) {
        case "next-experiments":
          checklistStateRef.current.clear();
          setChecklistBlocked(false);
          setExperimentsStep(true);
          return;
        case "request-review":
          setSubmitting(true);
          await apiCall(`/feature/${feature.id}/${revision.version}/request`, {
            method: "POST",
            body: JSON.stringify({
              mergeResultSerialized: JSON.stringify(mergeResult),
              comment,
            }),
          });
          await mutate();
          return;
        case "publish":
          setSubmitting(true);
          await apiCall(`/feature/${feature.id}/${revision.version}/publish`, {
            method: "POST",
            body: JSON.stringify({
              mergeResultSerialized: JSON.stringify(mergeResult),
              comment,
              adminOverride: adminPublish,
              publishExperimentIds: Array.from(selectedExperiments),
            }),
          });
          await mutate();
          onPublish && onPublish();
          return;
        default:
          return;
      }
    } catch (e) {
      await mutate();
      setSubmitError(e.message || "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  const doRecallReview = async () => {
    setSecondaryError(null);
    setSecondaryLoading("recall");
    try {
      await apiCall(
        `/feature/${feature.id}/${revision.version}/recall-review`,
        { method: "POST" },
      );
      // Refresh the log too — the Reviewers widget and timeline derive
      // verdict state from the log SWR key, not the revision data.
      await Promise.all([mutate(), mutateReviewLog()]);
    } catch (e) {
      setSecondaryError(e.message || "Something went wrong");
    } finally {
      setSecondaryLoading(null);
    }
  };

  const doUndoReview = async () => {
    setSecondaryError(null);
    setSecondaryLoading("undo");
    try {
      await apiCall(`/feature/${feature.id}/${revision.version}/undo-review`, {
        method: "POST",
      });
      await Promise.all([mutate(), mutateReviewLog()]);
    } catch (e) {
      setSecondaryError(e.message || "Something went wrong");
    } finally {
      setSecondaryLoading(null);
    }
  };

  const renderExperimentSelection = () =>
    experiments.length > 0 ? (
      <Box mb="3">
        {immediateStartExperiments.length > 0 && (
          <Box mb={scheduledExperiments.length > 0 ? "3" : "0"}>
            <Heading as="h4" size="small" mb="2">
              Start running experiments upon publishing:
            </Heading>
            {immediateStartExperiments.map((experiment) => (
              <Box key={experiment.id}>
                <Checkbox
                  value={selectedExperiments.has(experiment.id)}
                  setValue={(e) => {
                    const newValue = new Set(selectedExperiments);
                    if (e === true) newValue.add(experiment.id);
                    else newValue.delete(experiment.id);
                    setSelectedExperiments(newValue);
                  }}
                  label={experiment.name}
                />
              </Box>
            ))}
          </Box>
        )}
        {scheduledExperiments.length > 0 && (
          <Box>
            <Heading as="h4" size="small" mb="2">
              Approve scheduled start for experiments:
            </Heading>
            {scheduledExperiments.map((experiment) => (
              <Box key={experiment.id}>
                <Checkbox
                  value={selectedExperiments.has(experiment.id)}
                  setValue={(e) => {
                    const newValue = new Set(selectedExperiments);
                    if (e === true) newValue.add(experiment.id);
                    else newValue.delete(experiment.id);
                    setSelectedExperiments(newValue);
                  }}
                  label={experiment.name}
                />
              </Box>
            ))}
          </Box>
        )}
      </Box>
    ) : null;

  // ── Focused sub-flow modals (launched from the page) ──
  const conflictModal =
    resolveConflicts && !mergeResult.success ? (
      <PagedModal
        trackingEventModalType="resolve-conflicts"
        header={"Resolve Conflicts"}
        step={conflictStep}
        setStep={setConflictStep}
        submit={async () => {
          try {
            await apiCall(`/feature/${feature.id}/${revision.version}/rebase`, {
              method: "POST",
              body: JSON.stringify({
                mergeResultSerialized: JSON.stringify(mergeResult),
                strategies,
              }),
            });
          } catch (e) {
            await mutate();
            throw e;
          }
          await mutate();
        }}
        cta={conflictStep === 1 ? "Update Draft" : "Next"}
        ctaEnabled={!!mergeResult.success}
        close={() => setResolveConflicts(false)}
        closeCta="Cancel"
        size="max"
        useRadixButton={true}
      >
        <Page
          display="Fix Conflicts"
          enabled
          validate={async () => {
            if (!mergeResult?.success) {
              throw new Error("Please resolve all conflicts first");
            }
          }}
        >
          <Box
            mb="4"
            style={{ maxWidth: 800, margin: "0 auto var(--space-4)" }}
          >
            <Callout
              status="info"
              contentsAs="div"
              icon={<PiGitMergeBold size={18} />}
            >
              <Text as="p">
                Your draft is based on an older version, and the live version
                has since been published with conflicting changes. Resolve each
                conflict below, then click{" "}
                <Text as="span" weight="medium">
                  Update Draft
                </Text>{" "}
                to rebase your draft onto the current live version.
              </Text>
            </Callout>
          </Box>
          {mergeResult.conflicts.map((conflict) => (
            <ExpandableConflict
              conflict={conflict}
              key={conflict.name}
              strategy={strategies[conflict.key] || ""}
              setStrategy={(strategy) => {
                setStrategies({ ...strategies, [conflict.key]: strategy });
              }}
              liveRevision={liveRevision}
              draftRevision={revision}
            />
          ))}
        </Page>
        <Page display="Review Changes">
          {hasChanges ? (
            <Flex direction="column" gap="4">
              {resultDiffs
                .filter((d) => d.a !== d.b)
                .map((diff) => (
                  <ExpandableDiff
                    key={diff.title}
                    {...diff}
                    defaultOpen
                    styles={COMPACT_DIFF_STYLES}
                    leftTitle={
                      <RevisionLabel
                        version={liveRevision?.version ?? 0}
                        title={liveRevision?.title}
                        minWidth={0}
                      />
                    }
                    rightTitle={
                      <RevisionLabel
                        version={revision.version}
                        title={revision.title}
                        minWidth={0}
                      />
                    }
                  />
                ))}
            </Flex>
          ) : (
            <Text as="p" color="text-low">
              Your draft and the live version are identical.
            </Text>
          )}
        </Page>
      </PagedModal>
    ) : null;

  const canDoPrimary =
    state.submitAction === "publish" ? hasPublishPermission : true;

  // ── Simple full-width states (no two-column layout) ──
  if (!mergeResult.success) {
    return pageWrapper(
      <>
        {conflictModal}
        <Callout status="error" contentsAs="div">
          <Text as="p" weight="semibold" mb="1">
            Conflicts detected
          </Text>
          <Text as="p" mb="2">
            Changes were published to the live version that conflict with this
            draft. Resolve the conflicts to rebase your draft before publishing.
          </Text>
          <Button onClick={() => setResolveConflicts(true)}>
            Resolve conflicts
          </Button>
        </Callout>
      </>,
    );
  }
  if (!hasChanges) {
    return pageWrapper(
      <Callout status="info">
        There are no changes to publish. Either discard the draft or add changes
        first before publishing.
      </Callout>,
    );
  }

  // ── Full-width page header: big title, status badge, and a
  // one-line summary of which revision merges into which. We surface the review
  // requester (the revision author) once a review has actually been requested;
  // otherwise we just describe what would be merged. ──
  // Match the status colors/labels used by the revision selector badge.
  const reviewRequested =
    requireReviews &&
    (revision.status === "pending-review" ||
      revision.status === "approved" ||
      revision.status === "changes-requested");
  const requester = authorId ? users.get(authorId) : undefined;
  const requesterName = requester?.name || requester?.email || "";
  const headerTitle =
    revision.title?.trim() ||
    revision.comment?.trim() ||
    `Revision ${revision.version}`;
  const staleBase = revision.baseVersion !== feature.version;

  const mergeHeader = (
    <Box mb="6">
      <Heading as="h3" size="large" mb="2">
        {headerTitle}
      </Heading>
      <Flex align="center" gap="2">
        <Box style={{ flexShrink: 0 }}>
          <Badge
            size="lg"
            variant="soft"
            radius="full"
            color={revisionStatusColor(revision.status)}
            label={revisionStatusLabel(revision.status)}
          />
        </Box>
        <Text as="span" color="text-low">
          {reviewRequested && requesterName ? (
            <>
              <strong>{requesterName}</strong> requested review to merge{" "}
            </>
          ) : (
            <>Merging </>
          )}
          revision <strong>{revision.version}</strong> into the live version
          (revision <strong>{feature.version}</strong>)
          {staleBase ? <> · based on revision {revision.baseVersion}</> : null}
        </Text>
      </Flex>
    </Box>
  );

  // ── Left column: all of the changes, then history ──
  const changesColumn = experimentsStep ? (
    <Box>
      <Heading as="h3" size="medium" mb="3">
        Review &amp; {onlyScheduledSelected ? "Schedule" : "Publish"}
      </Heading>
      <Text as="p" mb="3">
        Please review the{" "}
        <strong>
          Pre-Launch Checklist
          {selectedExperiments.size !== 1 ? "s" : ""}
        </strong>{" "}
        for the experiment
        {selectedExperiments.size !== 1 ? "s" : ""} that will be{" "}
        {onlyScheduledSelected ? "scheduled to start" : "published"} along with
        this draft.
      </Text>
      {experiments.map((experiment) => {
        if (!selectedExperiments.has(experiment.id)) return null;
        const scheduledStartDate = getFutureScheduledStartDate(experiment);
        return (
          <Box key={experiment.id} mb="3">
            {scheduledStartDate && (
              <Callout status="info" mb="2">
                <strong>{experiment.name}</strong> will start on{" "}
                <strong>
                  {format(scheduledStartDate, "MMM d, yyyy 'at' h:mm a")}
                </strong>
                .
              </Callout>
            )}
            <PreLaunchChecklistForDraft
              experiment={experiment}
              feature={feature}
              mutateExperiment={mutate}
              envs={getAffectedEnvsForExperiment({
                experiment,
                orgEnvironments: allEnvironments,
                linkedFeatures: [],
              })}
              onReady={(failed, loading) =>
                handleChecklistReady(experiment.id, failed, loading)
              }
            />
          </Box>
        );
      })}
    </Box>
  ) : (
    // Left column shared with the read-only review (see renderLeftColumn).
    // The right actions column is rendered separately.
    renderLeftColumn(allDiffs, {
      before: currentRevisionData,
      after: draftRawAfter,
    })
  );

  // ── Right column: reviewer / approval-flow actions and state ──
  const statusColor = revisionStatusColor(revision.status);
  const actionsColumn = (
    <Box
      className="appbox"
      style={{ position: "sticky", top: 90, overflow: "hidden" }}
    >
      {/* Status header – colored tint matching the revision badge */}
      <Flex
        align="center"
        px="4"
        style={{
          background: `var(--${statusColor}-a3)`,
          borderBottom: "1px solid var(--gray-a4)",
          minHeight: 40,
        }}
      >
        <Flex
          align="center"
          gap="2"
          style={{ color: `var(--${statusColor}-11)` }}
        >
          <Box style={{ fontSize: 14, lineHeight: 1, display: "flex" }}>
            {revisionStatusIcon(revision.status)}
          </Box>
          <Heading as="h4" size="small">
            <span style={{ color: `var(--${statusColor}-11)` }}>
              {revisionStatusLabel(revision.status)}
            </span>
          </Heading>
        </Flex>

        {(state.canRecallReview || state.canUndoReview) && (
          <Box ml="auto" style={{ marginRight: -6 }}>
            <DropdownMenu
              trigger={
                <IconButton
                  variant="ghost"
                  color="gray"
                  radius="full"
                  size="2"
                  highContrast
                  style={{ margin: 0 }}
                >
                  <BsThreeDotsVertical size={16} />
                </IconButton>
              }
              open={actionsDropdownOpen}
              onOpenChange={setActionsDropdownOpen}
              menuPlacement="end"
              variant="soft"
            >
              <DropdownMenuGroup>
                {state.canRecallReview && (
                  <DropdownMenuItem
                    disabled={secondaryLoading !== null}
                    onClick={() => {
                      setActionsDropdownOpen(false);
                      doRecallReview();
                    }}
                  >
                    Retract review request
                  </DropdownMenuItem>
                )}
                {state.canUndoReview && (
                  <DropdownMenuItem
                    disabled={secondaryLoading !== null}
                    onClick={() => {
                      setActionsDropdownOpen(false);
                      doUndoReview();
                    }}
                  >
                    Retract review
                  </DropdownMenuItem>
                )}
              </DropdownMenuGroup>
            </DropdownMenu>
          </Box>
        )}
      </Flex>

      <Box p="4">
        {/* ── People: contributors first, reviewers (when required) just
            beneath. Both render compactly — avatar + name on top, email
            below — so long emails wrap naturally instead of overflowing
            the narrow actions column. ── */}
        {contributorIds.length > 0 && (
          <Box mb="3">
            <Text
              size="medium"
              weight="medium"
              color="text-high"
              as="div"
              mb="2"
            >
              Contributors
            </Text>
            <Flex direction="column" gap="2">
              {contributorIds.map((id) => {
                const u = users.get(id);
                return (
                  <PersonRow
                    key={id}
                    id={id}
                    name={u?.name || ""}
                    email={u?.email || ""}
                  />
                );
              })}
            </Flex>
          </Box>
        )}

        {requireReviews && reviewers.length > 0 && (
          <Box mb="3">
            <Text
              size="medium"
              weight="medium"
              color="text-high"
              as="div"
              mb="2"
            >
              Reviewers
            </Text>
            <Flex direction="column" gap="2">
              {reviewers.map(({ id, status }) => {
                const u = users.get(id);
                return (
                  <PersonRow
                    key={id}
                    id={id}
                    name={u?.name || ""}
                    email={u?.email || ""}
                    trailing={
                      <ReviewerVerdictIcon
                        status={status}
                        name={u?.name || u?.email || ""}
                      />
                    }
                  />
                );
              })}
            </Flex>
          </Box>
        )}

        {!experimentsStep &&
          (approved || !requireReviews) &&
          renderExperimentSelection()}

        {/* Submit review — reviewer action, opens the comment/decision popover */}
        {canReview && isPendingReview && !approved && (
          <Box mt="5">
            <ReviewCommentPopover
              featureId={feature.id}
              version={revision.version}
              isBlockedContributor={!!isBlockedContributor}
              onSuccess={async () => {
                await mutate();
                await revisionLogRef?.current?.mutateLog();
              }}
              trigger={
                <Button
                  style={{ width: "100%" }}
                  icon={<PiCaretDownBold />}
                  iconPosition="right"
                >
                  Submit review
                </Button>
              }
              side="bottom"
              align="center"
            />
          </Box>
        )}

        {/* ─── Publish footer ─── */}
        {(() => {
          // Step actions that come before publish (Request Review, Submit Review, Next).
          const isStepAction =
            state.mode === "main" &&
            state.hasSubmit &&
            state.submitAction !== "publish" &&
            state.submitAction !== "none";

          // What's blocking publish right now (raw, ignoring adminPublish so the
          // reason is still visible while the checkbox is unchecked).
          // `buttonLabel` — when set, the button shows this instead of "Publish"
          //   and no callout is rendered below (the label is self-explanatory).
          // `reason` — shown as a status callout below the button for technical
          //   blocks where the label alone isn't enough context (e.g. merge
          //   conflicts).
          type BlockInfo = {
            reason?: string;
            buttonLabel?: string;
            overridable: boolean;
          } | null;
          const blockInfo: BlockInfo = (() => {
            if (!mergeResult.success)
              return {
                reason: "Resolve merge conflicts before publishing.",
                overridable: false,
              };
            if (!hasChanges)
              return { buttonLabel: "Nothing to publish", overridable: false };
            if (!hasPublishPermission)
              return {
                buttonLabel: "No publish permission",
                overridable: false,
              };
            if (requireReviews && !adminPublish) {
              if (revision.status === "draft")
                return {
                  buttonLabel: "Review required to publish",
                  overridable: true,
                };
              if (revision.status === "pending-review")
                return {
                  buttonLabel: "Awaiting approval to publish",
                  overridable: true,
                };
              if (revision.status === "changes-requested")
                return {
                  buttonLabel: "Changes requested — cannot publish",
                  overridable: true,
                };
            }
            if (!adminPublish && !governance?.canPublish)
              return {
                buttonLabel: "Rebase required to publish",
                overridable: true,
              };
            if (!adminPublish && featureLockedByRamp)
              return {
                buttonLabel: "Locked by active ramp schedule",
                overridable: true,
              };
            return null;
          })();

          const publishEnabled =
            state.submitAction === "publish" &&
            state.ctaEnabled &&
            canDoPrimary;

          return (
            <>
              {/* Step CTA: Request Review / Submit Review / Next */}
              {isStepAction && (
                <Box mt="4">
                  <Button
                    variant="soft"
                    onClick={doSubmit}
                    loading={submitting}
                    disabled={!state.ctaEnabled}
                    style={{ width: "100%" }}
                  >
                    {state.ctaLabel}
                  </Button>
                </Box>
              )}

              {/* Publish section: divider, optional admin bypass, the
                  primary publish button. All status displays related to
                  publish state render uniformly below. */}
              <Box
                mt="4"
                pt="4"
                style={{ borderTop: "1px solid var(--gray-a5)" }}
              >
                {canAdminPublish &&
                  (blockInfo?.overridable || adminPublish) && (
                    <Box mb="3">
                      <Checkbox
                        label="Bypass checks and publish now (Admins only)"
                        weight="regular"
                        value={adminPublish}
                        setValue={(val) => {
                          setAdminPublish(!!val);
                          if (!val) {
                            checklistStateRef.current.clear();
                            setChecklistBlocked(false);
                            setExperimentsStep(false);
                          }
                        }}
                      />
                    </Box>
                  )}

                <Button
                  onClick={publishEnabled ? doSubmit : undefined}
                  loading={submitting && state.submitAction === "publish"}
                  disabled={!publishEnabled}
                  icon={state.ctaLocked ? <PiLockSimple /> : undefined}
                  style={{ width: "100%" }}
                >
                  {blockInfo?.buttonLabel ??
                    (onlyScheduledSelected ? "Schedule to Start" : "Publish")}
                </Button>

                {/* ── Uniform status displays for the publish state ──
                    All callouts use the same size, spacing, and chrome so
                    the column doesn't read as a pile of differently-styled
                    messages. Stacked in priority order: blocking reason,
                    governance/divergence, ramps, errors, and finally the
                    "no approval necessary" note. */}
                <Flex direction="column" gap="2" mt="3">
                  {blockInfo?.reason && (
                    <Callout
                      status={blockInfo.overridable ? "warning" : "error"}
                      size="sm"
                    >
                      {blockInfo.reason}
                    </Callout>
                  )}

                  {governance && (
                    <DivergenceNotice
                      governance={governance}
                      liveVersion={feature.version}
                      baseVersion={revision.baseVersion}
                      onUpdateFromLive={onUpdateFromLive}
                      updating={rebasing}
                      canRebase={permissionsUtil.canManageFeatureDrafts(
                        feature,
                      )}
                    />
                  )}

                  {linkedRamps.map((ramp) => (
                    <Callout key={ramp.id} status="info" size="sm">
                      Publishing this draft will activate ramp schedule{" "}
                      <strong>{ramp.name}</strong>. The ramp will begin once
                      this revision is live.
                    </Callout>
                  ))}

                  {submitError && (
                    <Callout status="error" size="sm">
                      {submitError}
                    </Callout>
                  )}

                  {secondaryError && (
                    <Callout status="error" size="sm">
                      {secondaryError}
                    </Callout>
                  )}

                  {!requireReviews && !experimentsStep && !blockInfo && (
                    <Text size="small" color="text-mid" as="p">
                      No approval necessary — these changes can be published
                      directly.
                    </Text>
                  )}
                </Flex>

                {experimentsStep && (
                  <Box mt="2">
                    <LinkButton
                      color="link"
                      onClick={() => {
                        checklistStateRef.current.clear();
                        setChecklistBlocked(false);
                        setExperimentsStep(false);
                      }}
                    >
                      <FaArrowLeft /> Back
                    </LinkButton>
                  </Box>
                )}
              </Box>
            </>
          );
        })()}
      </Box>
    </Box>
  );

  return pageWrapper(
    <>
      {conflictModal}
      {mergeHeader}
      <Flex gap="5" align="start">
        <Box style={{ flex: 1, minWidth: 0 }}>{changesColumn}</Box>
        <Box style={{ width: 360, minWidth: 360, flexShrink: 0 }}>
          {actionsColumn}
        </Box>
      </Flex>
    </>,
  );
}
