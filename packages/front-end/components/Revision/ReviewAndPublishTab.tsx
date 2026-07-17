import { ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import {
  Revision,
  checkMergeConflicts,
  getRevisionUpdatableFields,
  applyTopLevelPatchOps,
  isUserBlockedFromApproving,
  isAutopublishOnApprovalEnabled,
  isScheduledPublishPending,
  isScheduledPublishLockActive,
  findPublishLockingScheduledRevision,
} from "shared/enterprise";
import type { PublishGovernanceResult } from "shared/util";
import { datetime } from "shared/dates";
import { BsThreeDotsVertical } from "react-icons/bs";
import { PiCaretDownBold, PiGitMergeBold, PiLockSimple } from "react-icons/pi";
import { useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";
import useURLHash from "@/hooks/useURLHash";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import Heading from "@/ui/Heading";
import Callout from "@/ui/Callout";
import Checkbox from "@/ui/Checkbox";
import HelperText from "@/ui/HelperText";
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
} from "@/ui/DropdownMenu";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import EventUser from "@/components/Avatar/EventUser";
import OverflowText from "@/components/Experiment/TabbedPage/OverflowText";
import CommentComposer from "@/components/Comments/CommentComposer";
import ReviewCommentPopover from "@/components/Reviews/ReviewCommentPopover";
import DivergenceNotice from "@/components/Reviews/DivergenceNotice";
import {
  PersonRow,
  ReviewerVerdictIcon,
} from "@/components/Reviews/ReviewPeople";
import {
  RevisionLike,
  revisionStatusColor,
  revisionStatusIcon,
  revisionStatusLabel,
} from "@/components/Reviews/RevisionStatusBadge";
import { getReviewAndPublishState } from "@/components/Reviews/reviewAndPublishState";
import {
  buildAnchoredCommentMapFromReviews,
  REVIEW_SUBTAB_EVENT,
} from "@/components/Reviews/diffCommentRefs";
import { DiffCommentsProps } from "@/components/Reviews/Feature/RevisionDiffUtils";
import RevisionTimeline, {
  REVIEW_ACTIVITY_ACTIONS,
} from "@/components/Reviews/RevisionTimeline";
import ScheduledPublishControl from "@/components/Reviews/ScheduledPublishControl";
import ReviewHeader from "@/components/Reviews/ReviewHeader";
import { RevisionDiffContent } from "@/components/Reviews/RevisionDiffContent";
import RevisionDescription from "@/components/Reviews/RevisionDescription";
import { useRevisionDiff, RevisionDiffConfig } from "./useRevisionDiff";
import { RevisionDiff } from "./RevisionDiff";
import { revisionTimelineLogs } from "./revisionTimelineLogs";
import FixRevisionConflictsModal from "./FixRevisionConflictsModal";

// Sub-views of the review surface: "overview" is the conversation-first view
// (human-readable changes + review activity), "changes" is the diff-first
// view (JSON diffs with inline comments + the full edit timeline).
type ReviewSubTab = "overview" | "changes";

// Statuses where the revision is an editable draft moving through the
// review/publish lifecycle (vs. terminal merged/discarded).
const ACTIVE_STATUSES = [
  "draft",
  "pending-review",
  "approved",
  "changes-requested",
] as const;

// The feature state machine types `status` against the feature-revision
// union; the active statuses are identical across both systems, and the
// terminal "merged" maps onto "published".
function toBadgeStatus(
  status: Revision["status"],
): Parameters<typeof revisionStatusColor>[0] {
  return status === "merged" ? "published" : status;
}

// Drop top-level null/undefined keys. The backend stores revision snapshots via
// each entity's `buildSnapshot`, which strips nullish optional fields — so a
// stored snapshot has no key for e.g. an unset `project`, while the live entity
// still carries it as `null`. Normalizing both sides the same way keeps the
// divergence comparison symmetric (see the drift diff below).
function stripNullish<T>(obj: T): T {
  if (!obj || typeof obj !== "object") return obj;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (v === null || v === undefined) continue;
    out[k] = v;
  }
  return out as T;
}

// The 40px header band shared by the actions column and the revision-description
// card — one source of truth for the px/border/min-height styling.
function CardHeader({
  children,
  background,
  gap,
}: {
  children: ReactNode;
  background?: string;
  gap?: "1" | "2" | "3" | "4";
}) {
  return (
    <Flex
      align="center"
      gap={gap}
      px="4"
      style={{
        background,
        borderBottom: "1px solid var(--gray-a4)",
        minHeight: 40,
      }}
    >
      {children}
    </Flex>
  );
}

export interface ReviewAndPublishTabProps<T> {
  // The revision selected in the page header's revision dropdown. Null when
  // viewing the live state.
  revision: Revision | null;
  allRevisions: Revision[];
  // The live entity (merge target).
  currentState: T;
  diffConfig: RevisionDiffConfig<T>;
  // Entity display name + noun for the Changes-tab Copy-as exports
  // (e.g. "Checkout users" / "saved group").
  entityName?: string;
  entityNoun?: string;
  // Per-revision approval gate (caller applies org settings + e.g. the
  // metadata-only shortcut).
  requiresApproval: boolean;
  // The viewer can edit the underlying entity (manage drafts / review).
  canEditEntity: boolean;
  // The viewer can bypass the approval requirement (admin).
  canBypassApproval: boolean;
  // When set, publishing is blocked and this reason is shown (e.g. the entity is
  // locked/frozen at a published revision). Drafts, edits, review requests, and
  // discarding stay available — only paths that advance the live state are hidden.
  publishBlockedReason?: string;
  selectRevision: (revision: Revision | null) => void;
  onPublish: (revisionId: string) => Promise<void>;
  onDiscard: (revisionId: string) => Promise<void>;
  onReopen: (revisionId: string) => Promise<void>;
  // Opens the page-owned revert flow for a merged revision.
  onRevert?: (revision: Revision) => void;
  onCompareRevisions?: () => void;
  mutate: () => void | Promise<void>;
}

// The generic "Review & Publish" tab for RevisionModel-backed entities
// (currently saved groups). Mirrors the layout of the feature-flag
// equivalent (components/Reviews/Feature/ReviewAndPublish.tsx) while running
// on the generic revision backend; the two share the entity-agnostic pieces
// (state machine, badges, people rows, diff gutters, comment refs).
export default function ReviewAndPublishTab<T>(
  props: ReviewAndPublishTabProps<T>,
) {
  if (!props.revision) {
    return (
      <Box pt="4">
        <Callout status="info">
          You are viewing the live version. Select a revision from the dropdown
          above to review or publish its changes.
        </Callout>
      </Box>
    );
  }
  return <ReviewAndPublishRevision {...props} revision={props.revision} />;
}

function ReviewAndPublishRevision<T>({
  revision,
  allRevisions,
  currentState,
  diffConfig,
  entityName = "",
  entityNoun = "revision",
  requiresApproval,
  canEditEntity,
  canBypassApproval,
  publishBlockedReason,
  selectRevision,
  onPublish,
  onDiscard,
  onReopen,
  onRevert,
  onCompareRevisions,
  mutate,
}: ReviewAndPublishTabProps<T> & { revision: Revision }) {
  const { apiCall } = useAuth();
  const { users, userId, getUserDisplay, organization, hasCommercialFeature } =
    useUser();
  // Adapt the generic revision's baked reviews[] + activityLog[] into the
  // shared timeline's RevisionLog shape.
  const timelineLogs = useMemo(
    () =>
      revisionTimelineLogs(revision, (id) => {
        const u = users.get(id);
        return {
          name: u?.name || getUserDisplay(id) || "",
          email: u?.email || "",
        };
      }),
    [revision, users, getUserDisplay],
  );

  const isActiveDraft = (ACTIVE_STATUSES as readonly string[]).includes(
    revision.status,
  );

  // ── Live vs. previously-published (mirrors the feature tab). The live
  // revision is the most recently merged one (matching the page's
  // `displayRevision` derivation); `previousPublishedRevision` is the merged
  // revision just before it — the target a "Roll back" restores. ──
  const mergedNewestFirst = useMemo(
    () =>
      allRevisions
        .filter((r) => r.status === "merged")
        .sort(
          (a, b) =>
            new Date(b.dateUpdated).getTime() -
            new Date(a.dateUpdated).getTime(),
        ),
    [allRevisions],
  );
  const liveRevision = mergedNewestFirst[0];
  const isLive =
    !isActiveDraft && !!liveRevision && liveRevision.id === revision.id;
  const previousPublishedRevision = isLive ? mergedNewestFirst[1] : undefined;

  const isAuthor = !!userId && revision.authorId === userId;
  const contributorIds = useMemo(() => {
    const ids = revision.contributors ?? [];
    return ids.includes(revision.authorId) ? ids : [revision.authorId, ...ids];
  }, [revision.contributors, revision.authorId]);
  const isContributor = !!userId && contributorIds.includes(userId);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [adminPublish, setAdminPublish] = useState(false);
  const [showFixConflicts, setShowFixConflicts] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmReopen, setConfirmReopen] = useState(false);
  const [actionsDropdownOpen, setActionsDropdownOpen] = useState(false);

  // Reset per-revision UI state when the selection changes. Includes the
  // transient dialog/dropdown toggles so a stale one from the previously viewed
  // revision can't carry over (the tab isn't remounted on switch). `submitting`
  // is intentionally left alone — it's owned by the in-flight async handlers.
  useEffect(() => {
    setSubmitError(null);
    setAdminPublish(false);
    setShowFixConflicts(false);
    setConfirmDiscard(false);
    setConfirmReopen(false);
    setActionsDropdownOpen(false);
  }, [revision.id]);

  // ── Sub-tabs (mirrors the feature Review & Publish tab): `#review` reads
  // as Conversation, `#review,changes` as Changes. Diff-ref widgets in
  // comments broadcast a sub-tab request before scrolling. ──
  const [urlHash, setUrlHash] = useURLHash();
  const subTabHash = urlHash?.split(",")[1];
  const subTab: ReviewSubTab =
    subTabHash === "changes"
      ? "changes"
      : subTabHash === "overview"
        ? "overview"
        : // No explicit sub-tab in the URL: a revision in review defaults to
          // Changes so reviewers land on the diff; otherwise Conversation.
          revision.status === "pending-review" ||
            revision.status === "changes-requested"
          ? "changes"
          : "overview";
  const setSubTab = useCallback(
    (t: ReviewSubTab) => {
      setUrlHash(t === "changes" ? "review,changes" : "review,overview");
    },
    [setUrlHash],
  );
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail === "overview" || detail === "changes") setSubTab(detail);
    };
    window.addEventListener(REVIEW_SUBTAB_EVENT, handler);
    return () => window.removeEventListener(REVIEW_SUBTAB_EVENT, handler);
  }, [setSubTab]);

  // ── Merge state: client-side conflict check of the proposed ops against
  // the live entity (the server re-checks on merge). ──
  const mergeResult = useMemo(() => {
    if (!isActiveDraft) return null;
    return checkMergeConflicts(
      revision.target.snapshot as unknown as Record<string, unknown>,
      currentState as unknown as Record<string, unknown>,
      revision.target.proposedChanges,
      getRevisionUpdatableFields(revision.target.type),
    );
  }, [
    isActiveDraft,
    revision.target.snapshot,
    revision.target.proposedChanges,
    revision.target.type,
    currentState,
  ]);
  const mergeSuccess = !mergeResult || mergeResult.success;

  // ── Diffs: live + proposed ops for active drafts ("what publish would
  // do"); base snapshot + ops for merged/discarded ("what this revision
  // changed"). ──
  const baseSnapshot = isActiveDraft
    ? currentState
    : (revision.target.snapshot as T);
  const proposedSnapshot = applyTopLevelPatchOps(
    baseSnapshot as Record<string, unknown>,
    revision.target.proposedChanges,
  ) as T;
  const { diffs, badges, customRenderGroups } = useRevisionDiff<T>(
    baseSnapshot,
    proposedSnapshot,
    diffConfig,
  );
  const hasChanges = diffs.length > 0;

  // ── Divergence: has the live entity moved since this draft's base snapshot?
  // (distinct from a hard merge conflict). Diff the original base snapshot vs
  // live; a non-empty result means the draft is based on an older version. With
  // `requireRebaseBeforePublish` (or a now-stale approval) this gates publishing
  // and surfaces a "Rebase with live" affordance — mirrors the feature flow.
  // Both sides are nullish-stripped so the comparison matches how the backend
  // stores snapshots; otherwise an unset optional field (snapshot omits it, live
  // carries it as `null`) reads as drift the rebase can never clear. ──
  const driftSnapshot = useMemo(
    () => stripNullish(revision.target.snapshot as T),
    [revision.target.snapshot],
  );
  const driftLive = useMemo(() => stripNullish(currentState), [currentState]);
  const { diffs: driftDiffs } = useRevisionDiff<T>(
    driftSnapshot,
    driftLive,
    diffConfig,
  );
  const diverged = isActiveDraft && driftDiffs.length > 0;
  const requireRebase = !!organization?.settings?.requireRebaseBeforePublish;
  const staleApproval = revision.status === "approved" && diverged;
  const mustRebase =
    mergeSuccess && diverged && (requireRebase || staleApproval);

  // Governance result for the shared DivergenceNotice (the feature flow's
  // conflict / "rebase with live" banners). Built from the content-based
  // divergence above rather than version math, since revisions here have no
  // tracked base version.
  const governance: PublishGovernanceResult = {
    diverged,
    divergence: !mergeSuccess ? "conflict" : diverged ? "diverged" : "current",
    liveChanges: [],
    staleApproval,
    recommendRebase: !mergeSuccess || diverged || staleApproval,
    rebaseRequired: !mergeSuccess || mustRebase,
    canPublish: mergeSuccess && !mustRebase,
    blockReason: null,
  };
  const liveVersion = liveRevision?.version ?? 0;

  // ── Scheduled publish: a sibling draft's committed lock-others schedule
  // freezes publishing of this one (treated like the feature ramp/schedule lock). ──
  // Cheap array.find — no need to memoize.
  const lockingScheduledSibling = findPublishLockingScheduledRevision(
    allRevisions,
    revision.version,
  );
  const featureLockedBySchedule = !!lockingScheduledSibling;
  const scheduledPending = isScheduledPublishPending(revision);
  const scheduleArmedByAdmin =
    scheduledPending && !!revision.scheduledPublishBypassApproval;
  // A pending dated schedule blocks "publish now": the schedule card already
  // explains it and offers Cancel/Change, so (matching the feature tab) we hide
  // the otherwise-dead Publish button. An admin can override a non-admin-armed
  // schedule by checking the bypass box; an admin-armed schedule is
  // cancel-and-re-arm only, so it always blocks.
  const scheduleBlocksPublish =
    scheduledPending && (!adminPublish || scheduleArmedByAdmin);

  // ── Reviewers: latest active verdict per user. Cycle membership is persisted
  // on each review (`stale` is set by the model at every cycle reset — submit,
  // approval-reset, recall, reopen), so we read it directly rather than
  // recomputing cycle boundaries from the activity log. The separate
  // content-edit `stale` flag below is a display hint (a current-cycle verdict
  // that predates the last edit), not cycle membership. ──
  const reviewers = useMemo(() => {
    let lastContentEditAt: number | null = null;
    for (const e of revision.activityLog) {
      if (e.action !== "updated") continue;
      const t = new Date(e.dateCreated).getTime();
      if (lastContentEditAt === null || t > lastContentEditAt) {
        lastContentEditAt = t;
      }
    }
    const byUser = new Map<
      string,
      { status: "approved" | "changes-requested"; timestamp: string }
    >();
    const sorted = [...revision.reviews].sort(
      (a, b) =>
        new Date(a.dateCreated).getTime() - new Date(b.dateCreated).getTime(),
    );
    for (const r of sorted) {
      if (r.decision === "comment" || r.stale) continue;
      byUser.set(r.userId, {
        status: r.decision === "approve" ? "approved" : "changes-requested",
        timestamp: new Date(r.dateCreated).toISOString(),
      });
    }
    return Array.from(byUser, ([id, v]) => ({
      id,
      status: v.status,
      timestamp: v.timestamp,
      stale:
        lastContentEditAt !== null &&
        new Date(v.timestamp).getTime() < lastContentEditAt,
    }));
  }, [revision.activityLog, revision.reviews]);
  const isReviewer = !!userId && reviewers.some((r) => r.id === userId);

  // For the stale-approval banner: when the surviving approval was given (the
  // latest non-stale "approved" verdict in the current cycle). A revisions-since
  // count can't be passed — generic revisions track no base version
  // (approvedBaseVersion is feature-only), so DivergenceNotice falls back to its
  // unquantified "changes were published since" phrasing for that dimension.
  const approvedAt = useMemo<string | null>(() => {
    const approvals = reviewers
      .filter((r) => r.status === "approved")
      .map((r) => r.timestamp)
      .sort();
    return approvals[approvals.length - 1] ?? null;
  }, [reviewers]);

  // ── Review requester: whoever submitted the revision for review, for the
  // header's "<name> requested review to merge …" line. Attribute it to the
  // latest "review-requested" activity entry (the dedicated submit-for-review
  // action); older revisions predating that action fall back to the legacy
  // "reopened" stopgap, then to the author. Resolved through the same
  // members/getUserDisplay path the reviewers section uses. ──
  const reviewRequesterId = useMemo<string | undefined>(() => {
    const sorted = [...revision.activityLog].sort(
      (a, b) =>
        new Date(b.dateCreated).getTime() - new Date(a.dateCreated).getTime(),
    );
    const requested = sorted.find((e) => e.action === "review-requested");
    if (requested) return requested.userId;
    const reopened = sorted.find((e) => e.action === "reopened");
    return reopened?.userId;
  }, [revision.activityLog]);
  const reviewRequested =
    requiresApproval &&
    (revision.status === "pending-review" ||
      revision.status === "approved" ||
      revision.status === "changes-requested");
  const reviewRequesterName = reviewRequested
    ? (() => {
        const id = reviewRequesterId ?? revision.authorId;
        const u = users.get(id);
        return u?.name || u?.email || getUserDisplay(id) || "";
      })()
    : "";

  const isBlockedContributor =
    !!userId &&
    hasCommercialFeature("require-approvals") &&
    isUserBlockedFromApproving({
      settings: organization?.settings,
      entityType: revision.target.type,
      revision,
      userId,
    });

  const autopublishOnApproval =
    isAutopublishOnApprovalEnabled(
      organization?.settings,
      revision.target.type,
      // Constants match their per-project `requireReviews` rule, so the
      // entity's project must be passed; ignored for approvalFlows entities.
      (revision.target.snapshot as { project?: string }).project,
    ) && hasCommercialFeature("require-approvals");
  const revisionAutoPublishArmed = !!revision.autoPublishOnApproval;

  const isPendingReview =
    revision.status === "pending-review" ||
    revision.status === "changes-requested";
  const canReview = isPendingReview && !isAuthor && canEditEntity;
  const approved = revision.status === "approved" || adminPublish;

  // ── Comments: posted as `comment`-decision reviews on the generic
  // revision endpoint; diff-ref blocks in the markdown resolve to gutter
  // markers in the Changes tab's JSON diffs. ──
  const getUserName = useCallback(
    (id: string) => {
      const u = users.get(id);
      return u?.name || u?.email || undefined;
    },
    [users],
  );
  const submitComment = useCallback(
    async (comment: string) => {
      await apiCall(`/revision/${revision.id}/review`, {
        method: "POST",
        body: JSON.stringify({ decision: "comment", comment }),
      });
      await mutate();
    },
    [apiCall, revision.id, mutate],
  );
  const diffCommentAnchors = useMemo(
    () => buildAnchoredCommentMapFromReviews(revision.reviews, getUserName),
    [revision.reviews, getUserName],
  );
  const diffComments = useMemo<DiffCommentsProps>(
    () => ({
      anchors: diffCommentAnchors,
      onSubmitNew: isActiveDraft && canEditEntity ? submitComment : undefined,
    }),
    [diffCommentAnchors, isActiveDraft, canEditEntity, submitComment],
  );

  // ── Lifecycle actions ──
  const doRequestReview = async () => {
    setSubmitError(null);
    setSubmitting(true);
    try {
      await apiCall(`/revision/${revision.id}/submit`, {
        method: "POST",
        // Preserve whatever arming the user set via ScheduledPublishControl.
        body: JSON.stringify({
          autoPublishOnApproval: !!revision.autoPublishOnApproval,
        }),
      });
      await mutate();
    } catch (e) {
      setSubmitError((e as Error).message || "Failed to request review");
    } finally {
      setSubmitting(false);
    }
  };

  const doPublish = async () => {
    setSubmitError(null);
    setSubmitting(true);
    try {
      await onPublish(revision.id);
    } catch (e) {
      setSubmitError((e as Error).message || "Failed to publish");
    } finally {
      setSubmitting(false);
    }
  };

  // Pull a review request back to draft (clears verdicts; disarms auto-publish).
  const doRecallReview = async () => {
    setSubmitError(null);
    setSubmitting(true);
    try {
      await apiCall(`/revision/${revision.id}/recall-review`, {
        method: "POST",
      });
      await mutate();
    } catch (e) {
      setSubmitError((e as Error).message || "Failed to return to draft");
    } finally {
      setSubmitting(false);
    }
  };

  // Retract the current user's own review verdict.
  const doUndoReview = async () => {
    setSubmitError(null);
    setSubmitting(true);
    try {
      await apiCall(`/revision/${revision.id}/undo-review`, { method: "POST" });
      await mutate();
    } catch (e) {
      setSubmitError((e as Error).message || "Failed to retract review");
    } finally {
      setSubmitting(false);
    }
  };

  // Rebase onto current live. Clean (no conflicts) → apply the up-to-date merge
  // directly; conflicting → open the conflict-resolution modal.
  const doRebase = async () => {
    if (!mergeSuccess) {
      setShowFixConflicts(true);
      return;
    }
    setSubmitError(null);
    setSubmitting(true);
    try {
      const res = await apiCall<{ revision?: Revision }>(
        `/revision/${revision.id}/rebase`,
        {
          method: "POST",
          body: JSON.stringify({
            strategies: {},
            mergeResultSerialized: JSON.stringify({ conflicts: [] }),
          }),
        },
      );
      if (res?.revision) selectRevision(res.revision);
      await mutate();
    } catch (e) {
      setSubmitError((e as Error).message || "Failed to rebase");
    } finally {
      setSubmitting(false);
    }
  };

  // Reviewer popover submission. Throws so the popover surfaces the error
  // inline. "Submit and Publish" on an armed revision goes through
  // approve-and-publish; the backend auto-publish also fires on a plain
  // approve when armed.
  const submitReviewDecision = async (
    decision: "comment" | "request-changes" | "approve",
    comment: string,
  ) => {
    if (decision === "approve" && revisionAutoPublishArmed) {
      await apiCall(`/revision/${revision.id}/approve-and-publish`, {
        method: "POST",
        body: JSON.stringify({ comment }),
      });
    } else {
      await apiCall(`/revision/${revision.id}/review`, {
        method: "POST",
        body: JSON.stringify({ decision, comment }),
      });
    }
    await mutate();
  };

  // ── CTA state machine (shared with the feature tab). Feature-only inputs
  // are neutralized: no experiments, ramps, scheduled-publish locks, or
  // rebase governance here — conflicts gate publishing via `mergeSuccess`. ──
  const state = getReviewAndPublishState({
    requireReviews: requiresApproval,
    status: toBadgeStatus(revision.status) as Parameters<
      typeof getReviewAndPublishState
    >[0]["status"],
    mergeSuccess,
    hasChanges,
    hasReviewPermission: canEditEntity,
    canManageDraft: canEditEntity,
    isReviewRequester: isAuthor,
    isContributor,
    isReviewer,
    adminPublish,
    hasSelectedExperiments: false,
    onlyScheduledSelected: false,
    experimentsStep: false,
    featureLockedByRamp: false,
    featureLockedBySchedule,
    checklistBlocked: false,
    governanceCanPublish: !mustRebase,
  });

  // The publish controls (admin-bypass checkbox + Publish button) show only when
  // the revision is publishable or an admin can bypass — mirrors the feature's
  // showPublishSection, so a disabled Publish button isn't shown prematurely on a
  // not-yet-approved draft.
  const adminBypassAvailable =
    canBypassApproval &&
    requiresApproval &&
    mergeSuccess &&
    hasChanges &&
    (revision.status !== "approved" || adminPublish);

  const doSubmit = async () => {
    if (state.submitAction === "request-review") return doRequestReview();
    if (state.submitAction === "publish") return doPublish();
  };

  // ── Shared layout pieces ──
  // The live revision reads as a green "Live" badge (matching the feature
  // tab); other terminal/merged revisions fall back to "Locked".
  const statusForBadge = isLive ? "live" : toBadgeStatus(revision.status);
  // The actions-column header band reflects the review lifecycle, not deployment
  // state — "Live"/"Locked" aren't lifecycle stages, so terminal (merged/live)
  // revisions all read as "Published" (grey) here, matching the feature tab. The
  // title badge above still shows the precise Live/Locked state; discarded stays
  // as-is (it can be reopened).
  const isDiscarded = revision.status === "discarded";
  const headerStatus: Parameters<typeof revisionStatusColor>[0] = isActiveDraft
    ? statusForBadge
    : isDiscarded
      ? "discarded"
      : "published";
  const headerStatusColor = revisionStatusColor(headerStatus);
  const headerStatusLabel = isActiveDraft
    ? revisionStatusLabel(statusForBadge)
    : isDiscarded
      ? "Discarded"
      : "Published";
  const headerStatusIcon = isActiveDraft ? (
    revisionStatusIcon(statusForBadge)
  ) : isDiscarded ? (
    revisionStatusIcon("discarded")
  ) : (
    <PiGitMergeBold />
  );
  const headerTitle =
    revision.title?.trim() ||
    revision.comment?.trim() ||
    `Revision ${revision.version ?? ""}`.trim();

  // Other active drafts of this entity, surfaced as quick navigation in the
  // header — mirrors the feature flow's "N other drafts need attention" nav.
  const otherAttentionDrafts = allRevisions
    .filter(
      (r) =>
        (ACTIVE_STATUSES as readonly string[]).includes(r.status) &&
        r.id !== revision.id,
    )
    .sort((a, b) => (b.version ?? 0) - (a.version ?? 0));
  // The shared Review & Publish top section (title + status + merging line +
  // other-drafts nav + sub-tab bar). Saved groups has no distinct base revision,
  // so `baseVersion` is omitted (the "· based on revision N" text is feature-only).
  const reviewHeader = (
    <ReviewHeader
      title={headerTitle}
      badgeStatus={statusForBadge}
      version={revision.version ?? 0}
      liveVersion={liveVersion}
      reviewRequesterName={reviewRequesterName || undefined}
      lifecycle={
        revision.status === "merged"
          ? "merged"
          : revision.status === "discarded"
            ? "discarded"
            : "active"
      }
      publishedDate={revision.resolution?.dateCreated}
      otherDrafts={otherAttentionDrafts.map((r) => ({
        key: r.id,
        version: r.version ?? 0,
        title: r.title,
        badge: {
          version: r.version ?? 0,
          status: toBadgeStatus(r.status),
        } as RevisionLike,
        onNavigate: () => selectRevision(r),
      }))}
      subTab={subTab}
      setSubTab={setSubTab}
      onCompareRevisions={onCompareRevisions}
    />
  );

  const leftColumn = (
    <>
      {subTab === "overview" && (
        <RevisionDescription
          description={revision.comment}
          canEdit={isActiveDraft && canEditEntity}
          onEdit={async (value) => {
            await apiCall(`/revision/${revision.id}/description`, {
              method: "PATCH",
              body: JSON.stringify({ description: value }),
            });
            await mutate();
          }}
          editorMeta={
            <>
              <EventUser
                user={{
                  type: "dashboard",
                  id: revision.authorId,
                  name:
                    users.get(revision.authorId)?.name ||
                    getUserDisplay(revision.authorId) ||
                    "",
                  email: users.get(revision.authorId)?.email || "",
                }}
                display="avatar-name"
                size="sm"
                wrap={true}
              />
              {users.get(revision.authorId)?.email && (
                <OverflowText
                  maxWidth={220}
                  title={users.get(revision.authorId)?.email}
                  style={{
                    color: "var(--gray-9)",
                    fontSize: "var(--font-size-1)",
                  }}
                >
                  {`<${users.get(revision.authorId)?.email}>`}
                </OverflowText>
              )}
              <Box flexShrink="0" style={{ whiteSpace: "nowrap" }}>
                <Text size="small" color="text-low">
                  {" · "}
                  {datetime(revision.dateUpdated)}
                </Text>
              </Box>
            </>
          }
        />
      )}

      {subTab === "overview" ? (
        <Box className="appbox" p="4" mb="0">
          <RevisionDiff
            diffs={diffs}
            badges={badges}
            customRenderGroups={customRenderGroups}
            variant="formatted"
            collapsedMaxHeight={250}
          />
        </Box>
      ) : (
        // Changes tab: the feature's diff chrome (JSON/raw toggle + Copy-as),
        // fed the saved-group diff items.
        <Box className="appbox" mb="0">
          <RevisionDiffContent
            diffs={diffs}
            diffComments={diffComments}
            raw={{ before: baseSnapshot, after: proposedSnapshot }}
            entityName={entityName}
            entityNoun={entityNoun}
            formats={["json", "raw"]}
          />
        </Box>
      )}

      <Box mb="4">
        <RevisionTimeline
          logs={timelineLogs}
          onRetractVerdict={state.canUndoReview ? doUndoReview : undefined}
          collapseFilter={
            subTab === "overview"
              ? (l) => REVIEW_ACTIVITY_ACTIONS.has(l.action)
              : undefined
          }
          onEditComment={
            isActiveDraft && canEditEntity
              ? async (logId, comment) => {
                  await apiCall(`/revision/${revision.id}/comment/${logId}`, {
                    method: "PUT",
                    body: JSON.stringify({ comment }),
                  });
                  await mutate();
                }
              : undefined
          }
          onDeleteComment={
            isActiveDraft && canEditEntity
              ? async (logId) => {
                  await apiCall(`/revision/${revision.id}/comment/${logId}`, {
                    method: "DELETE",
                  });
                  await mutate();
                }
              : undefined
          }
        />

        {/* Composer below the timeline — entries are chronological (newest
            at the bottom), so new comments appear right above it. */}
        {isActiveDraft && canEditEntity && (
          <Flex align="start" gap="3" mt="4">
            <Box flexShrink="0">
              <EventUser
                user={{
                  type: "dashboard",
                  id: userId || "",
                  name: (userId && users.get(userId)?.name) || "",
                  email: (userId && users.get(userId)?.email) || "",
                }}
                display="avatar"
                size="md"
              />
            </Box>
            <Box flexGrow="1" style={{ minWidth: 0 }}>
              <Flex align="center" style={{ height: 32 }}>
                <Heading as="h4" size="small" mb="0">
                  Add a comment
                </Heading>
              </Flex>
              <CommentComposer
                placeholder="Leave a comment…"
                onSubmit={submitComment}
              />
            </Box>
          </Flex>
        )}
      </Box>
    </>
  );

  const peopleSection = (
    <>
      {contributorIds.length > 0 && (
        <Box mb="3">
          <Text size="medium" weight="medium" color="text-high" as="div" mb="2">
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

      {requiresApproval && reviewers.length > 0 && (
        <Box mb="3">
          <Text size="medium" weight="medium" color="text-high" as="div" mb="2">
            Reviewers
          </Text>
          <Flex direction="column" gap="2">
            {reviewers.map(({ id, status, timestamp, stale }) => {
              const u = users.get(id);
              // The generic revision's reviews[] carries only userId (no baked
              // event-user name/email like features). For reviewers absent from
              // the members map (API key / SCIM-removed users) fall back to
              // getUserDisplay so PersonRow shows the id rather than "Unknown".
              const name = u?.name || getUserDisplay(id) || "";
              const email = u?.email || "";
              return (
                <PersonRow
                  key={id}
                  id={id}
                  name={name}
                  email={email}
                  trailing={
                    <ReviewerVerdictIcon
                      status={status}
                      name={name || email}
                      timestamp={timestamp}
                      stale={stale}
                    />
                  }
                />
              );
            })}
          </Flex>
        </Box>
      )}
    </>
  );

  const actionsColumnHeader = (
    <CardHeader background={`var(--${headerStatusColor}-a3)`}>
      <Flex
        align="center"
        gap="2"
        style={{ color: `var(--${headerStatusColor}-11)` }}
      >
        {headerStatusIcon && (
          <Box style={{ fontSize: 18, lineHeight: 1, display: "flex" }}>
            {headerStatusIcon}
          </Box>
        )}
        <Heading as="h4" size="small">
          <span style={{ color: `var(--${headerStatusColor}-11)` }}>
            {headerStatusLabel}
          </span>
        </Heading>
      </Flex>

      {isActiveDraft &&
        (state.canRecallReview || state.canUndoReview || canEditEntity) && (
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
                    disabled={submitting}
                    onClick={() => {
                      setActionsDropdownOpen(false);
                      doRecallReview();
                    }}
                  >
                    Return to draft state
                  </DropdownMenuItem>
                )}
                {state.canUndoReview && (
                  <DropdownMenuItem
                    disabled={submitting}
                    onClick={() => {
                      setActionsDropdownOpen(false);
                      doUndoReview();
                    }}
                  >
                    Retract review
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  color="red"
                  disabled={submitting}
                  onClick={() => {
                    setActionsDropdownOpen(false);
                    setConfirmDiscard(true);
                  }}
                >
                  Discard draft
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenu>
          </Box>
        )}
    </CardHeader>
  );

  // ── Read-only actions column (merged / discarded) ──
  const readonlyActionsColumn = (
    <Box
      className="appbox"
      style={{ position: "sticky", top: 90, overflow: "hidden" }}
    >
      {actionsColumnHeader}
      <Box p="4">
        {peopleSection}

        <Box mt="5" mb="4">
          <HelperText status="info" size="sm">
            {revision.status === "discarded" ? (
              <>
                This revision was discarded. Reopen it as a draft to continue
                editing, request review, and publish.
              </>
            ) : isLive ? (
              <>
                This revision is currently live. Rolling back reverts to the
                previously published revision.
              </>
            ) : (
              <>
                This revision was published and is now locked.
                {onRevert ? " You can revert back to this revision." : ""}
              </>
            )}
          </HelperText>
        </Box>

        {revision.status === "discarded" ? (
          <Button
            onClick={() => setConfirmReopen(true)}
            disabled={!canEditEntity}
            style={{ width: "100%" }}
          >
            Reopen as draft
          </Button>
        ) : isLive ? (
          onRevert ? (
            <Button
              color="red"
              variant="outline"
              onClick={() =>
                previousPublishedRevision && onRevert(previousPublishedRevision)
              }
              disabled={!canEditEntity || !previousPublishedRevision}
              style={{ width: "100%" }}
            >
              Roll back
            </Button>
          ) : null
        ) : onRevert ? (
          <Button
            color="red"
            variant="outline"
            onClick={() => onRevert(revision)}
            disabled={!canEditEntity}
            style={{ width: "100%" }}
          >
            Revert to this revision
          </Button>
        ) : null}

        {!canEditEntity && (
          <HelperText status="info" size="md" mt="5">
            You don&apos;t have permission to manage revisions for this entity.
          </HelperText>
        )}
        {isLive && canEditEntity && onRevert && !previousPublishedRevision && (
          <HelperText status="info" size="md" mt="5">
            There is no previously published revision to roll back to.
          </HelperText>
        )}
      </Box>
    </Box>
  );

  // ── Active-draft actions column ──
  const draftActionsColumn = (
    <Box
      className="appbox"
      style={{ position: "sticky", top: 90, overflow: "hidden" }}
    >
      {actionsColumnHeader}
      <Box p="4">
        {peopleSection}

        <Box mt="6">
          {/* Submit review — reviewer action, opens the comment/decision
              popover */}
          {canReview && requiresApproval && !approved && (
            <Flex direction="column" gap="3" mb="4">
              <ReviewCommentPopover
                onSubmit={submitReviewDecision}
                allowPublishOnApprove={autopublishOnApproval}
                autoPublishArmed={revisionAutoPublishArmed}
                autoPublishScheduled={scheduledPending}
                canReviewerPublish={canEditEntity}
                publishBlocked={
                  !mergeSuccess ||
                  !hasChanges ||
                  mustRebase ||
                  !!publishBlockedReason
                }
                isBlockedContributor={!!isBlockedContributor}
                storageKey={`review-comment:${revision.target.type}:${revision.id}`}
                onSuccess={() => {}}
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
            </Flex>
          )}

          {/* Step CTA: Request Review */}
          {state.hasSubmit && state.submitAction === "request-review" && (
            <Box mt="4">
              <Button
                variant="soft"
                onClick={doSubmit}
                loading={submitting}
                disabled={!state.ctaEnabled || !canEditEntity}
                style={{ width: "100%" }}
              >
                {state.ctaLabel}
              </Button>
            </Box>
          )}

          {/* Publish section */}
          <Box mt="4" pt="4" style={{ borderTop: "1px solid var(--gray-a5)" }}>
            {/* Conflict / divergence / stale-approval banners — shared with the
                feature flow so the revision tab reads identically. */}
            {(governance.divergence !== "current" || staleApproval) && (
              <Box mb="3">
                <DivergenceNotice
                  governance={governance}
                  liveVersion={liveVersion}
                  baseVersion={liveVersion}
                  canRebase={canEditEntity}
                  updating={submitting}
                  onResolveConflicts={() => setShowFixConflicts(true)}
                  onUpdateFromLive={doRebase}
                  approvedAt={approvedAt}
                />
              </Box>
            )}

            {/* Auto-publish / scheduled-publish arming (also works post-request).
                Mirrors the feature publish section: directly under the
                divergence notice, above the admin-bypass + Publish button.
                Hidden when publishing is blocked (e.g. a locked config) — a
                schedule would just fail to fire. */}
            {isActiveDraft && !publishBlockedReason && (
              <ScheduledPublishControl
                revision={revision}
                pending={isScheduledPublishPending(revision)}
                lockActive={isScheduledPublishLockActive(revision)}
                schedulePublishPath={`/revision/${revision.id}/schedule-publish`}
                toggleAutoPublishPath={`/revision/${revision.id}/toggle-auto-publish`}
                entityNoun={entityNoun}
                canEdit={canEditEntity}
                canBypassApproval={canBypassApproval}
                requiresApproval={requiresApproval}
                autopublishOnApproval={autopublishOnApproval}
                isReviewRequester={isAuthor}
                mutate={mutate}
              />
            )}

            {adminBypassAvailable && !publishBlockedReason && (
              <Box mb="3">
                <Checkbox
                  label={
                    <span style={{ color: "var(--red-11)" }}>
                      Admin: bypass approval and publish now
                    </span>
                  }
                  weight="regular"
                  value={adminPublish}
                  setValue={(val) => setAdminPublish(!!val)}
                />
              </Box>
            )}

            {!scheduleBlocksPublish &&
              !publishBlockedReason &&
              (state.submitAction === "publish" || adminBypassAvailable) && (
                <Button
                  onClick={
                    state.submitAction === "publish" &&
                    state.ctaEnabled &&
                    canEditEntity
                      ? doSubmit
                      : undefined
                  }
                  loading={submitting && state.submitAction === "publish"}
                  disabled={
                    state.submitAction !== "publish" ||
                    !state.ctaEnabled ||
                    !canEditEntity
                  }
                  icon={state.ctaLocked ? <PiLockSimple /> : undefined}
                  style={{ width: "100%" }}
                >
                  {state.ctaLabel}
                </Button>
              )}

            <Flex direction="column" gap="2" mt="3">
              {/* Entity-level publish lock (e.g. a locked config). */}
              {publishBlockedReason && (
                <Callout status="warning" size="sm">
                  {publishBlockedReason}
                </Callout>
              )}

              {/* A sibling draft's committed lock-others schedule freezes publish. */}
              {featureLockedBySchedule && !adminPublish && (
                <Callout status="warning" size="sm">
                  Another draft (Revision {lockingScheduledSibling?.version}) is
                  scheduled to publish and has locked publishing of other
                  drafts. Cancel that schedule to publish this one.
                </Callout>
              )}

              {submitError && (
                <Callout status="error" size="sm">
                  {submitError}
                </Callout>
              )}

              {!hasChanges && (
                <Callout status="info" size="sm">
                  No changes to publish. Discard the draft or add changes first.
                </Callout>
              )}

              {!requiresApproval && hasChanges && (
                <Text size="small" color="text-mid" as="p">
                  No approval necessary — these changes can be published
                  directly.
                </Text>
              )}
            </Flex>
          </Box>
        </Box>
      </Box>
    </Box>
  );

  return (
    <Box pt="4">
      {showFixConflicts && mergeResult && !mergeResult.success && (
        <FixRevisionConflictsModal
          revision={revision}
          currentState={currentState as Record<string, unknown>}
          close={() => setShowFixConflicts(false)}
          onRebased={(updated) => selectRevision(updated)}
          mutate={async () => {
            setShowFixConflicts(false);
            await mutate();
          }}
        />
      )}
      {confirmDiscard && (
        <ModalStandard
          trackingEventModalType="discard-revision"
          open={true}
          header="Discard Draft"
          cta="Discard"
          ctaColor="red"
          close={() => setConfirmDiscard(false)}
          submit={async () => {
            await onDiscard(revision.id);
          }}
        >
          Are you sure you want to discard this draft? This action cannot be
          undone.
        </ModalStandard>
      )}
      {confirmReopen && (
        <ModalStandard
          trackingEventModalType="reopen-revision"
          open={true}
          header="Reopen Revision"
          cta="Reopen"
          close={() => setConfirmReopen(false)}
          submit={async () => {
            await onReopen(revision.id);
          }}
        >
          This will reopen the revision and allow you to make further changes or
          request review again.
        </ModalStandard>
      )}

      {reviewHeader}
      <Flex gap="5" align="start" direction={{ initial: "column", md: "row" }}>
        <Box
          width={{ initial: "100%", md: "auto" }}
          flexGrow={{ initial: "0", md: "1" }}
          style={{ minWidth: 0 }}
        >
          {leftColumn}
        </Box>
        <Box
          width={{ initial: "100%", md: "360px" }}
          minWidth={{ initial: "0", md: "360px" }}
          flexShrink="0"
        >
          {isActiveDraft ? draftActionsColumn : readonlyActionsColumn}
        </Box>
      </Flex>
    </Box>
  );
}
