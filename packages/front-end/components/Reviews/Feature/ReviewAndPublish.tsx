import { FeatureInterface } from "shared/types/feature";
import { useState, useMemo, useRef, useCallback, useEffect } from "react";
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
  getEnvsFromRampSchedule,
  mergeResultHasChanges,
  getReviewSetting,
  getFeatureAutopublishOnApproval,
  checkIfRevisionNeedsReview,
  evaluatePublishGovernance,
  getLiveChangesSinceBase,
  MergeStrategy,
} from "shared/util";
import {
  isScheduledPublishPending,
  isScheduledPublishLockActive,
  findPublishLockingScheduledRevision,
} from "shared/enterprise";
import {
  EventUserLoggedIn,
  EventUserApiKey,
} from "shared/types/events/event-types";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { FaArrowLeft } from "react-icons/fa";
import {
  PiLockSimple,
  PiLock,
  PiClockFill,
  PiGitMergeBold,
  PiCaretDownBold,
} from "react-icons/pi";
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
import Revisionlog, {
  MutateLog,
  REVIEW_ACTIVITY_ACTIONS,
} from "@/components/Reviews/Feature/RevisionLog";
import useApi from "@/hooks/useApi";
import RevisionLabel from "@/components/Reviews/RevisionLabel";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import {
  useFeatureRevisionDiff,
  featureToFeatureRevisionDiffInput,
  mergeResultToDiffInput,
  revisionToFeatureRevisionDiffInput,
  FeatureRevisionDiffInput,
  FeatureRevisionDiff,
} from "@/hooks/useFeatureRevisionDiff";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import DatePicker from "@/components/DatePicker";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import Heading from "@/ui/Heading";
import {
  revisionStatusColor,
  revisionStatusIcon,
  revisionStatusLabel,
} from "@/components/Reviews/RevisionStatusBadge";
import Callout from "@/ui/Callout";
import Checkbox from "@/ui/Checkbox";
import SelectField from "@/components/Forms/SelectField";
import { useHoldouts } from "@/hooks/useHoldouts";
import { PreLaunchChecklistForDraftFeature } from "@/components/PreLaunchChecklist/PreLaunchChecklist";
import { COMPACT_DIFF_STYLES } from "@/components/AuditHistoryExplorer/CompareAuditEventsUtils";
import {
  ExpandableDiff,
  ExpandableConflict,
  buildRampDiffs,
  DiffContent,
  DiffCommentsProps,
  RevisionCommentSection,
} from "@/components/Reviews/Feature/RevisionDiffUtils";
import {
  buildAnchoredCommentMap,
  REVIEW_SUBTAB_EVENT,
  scrollToLatestRevisionLogEntry,
} from "@/components/Reviews/diffCommentRefs";
import useURLHash from "@/hooks/useURLHash";

// Sub-views of the review surface: "overview" is the conversation-first view
// (notes, human-readable changes, review activity), "changes" is the diff-first
// view (JSON diffs, full edit timeline, inline diff comments).
type ReviewSubTab = "overview" | "changes";
import DivergenceNotice from "@/components/Reviews/DivergenceNotice";
import NoticeBanner from "@/components/Reviews/NoticeBanner";
import HelperText from "@/ui/HelperText";
import Metadata from "@/ui/Metadata";
import ReviewCommentPopover from "@/components/Reviews/ReviewCommentPopover";
import CommentComposer from "@/components/Comments/CommentComposer";
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
} from "@/ui/DropdownMenu";
import RevertModal from "@/components/Reviews/Feature/RevertModal";
import { getReviewAndPublishState } from "@/components/Reviews/reviewAndPublishState";
import {
  PersonRow,
  ReviewerVerdictIcon,
} from "@/components/Reviews/ReviewPeople";
import ReviewHeader, {
  ReviewHeaderOtherDraft,
} from "@/components/Reviews/ReviewHeader";

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
  // Opens the cross-revision compare modal (owned by the feature page).
  onCompareRevisions?: () => void;
  experiments?: ExperimentInterfaceStringDates[];
  rampSchedules?: RampScheduleInterface[];
}

// The feature-page "Review & Publish" tab. Consolidates the former DraftModal
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
  onCompareRevisions,
  experiments: experimentsList,
  rampSchedules,
}: Props) {
  const allEnvironments = useEnvironments();
  const environments = filterEnvironmentsByFeature(allEnvironments, feature);
  const envIds = environments.map((e) => e.id);
  const permissionsUtil = usePermissionsUtil();
  // POST /feature/:id/:version/comment requires canReviewFeatureDrafts.
  const canCommentOnDraft = permissionsUtil.canReviewFeatureDrafts(feature);
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

  // Other active drafts, offered as quick navigation in the revision header.
  const otherAttentionDrafts = revisionList
    .filter(
      (r) =>
        (ACTIVE_DRAFT_STATUSES as readonly string[]).includes(r.status) &&
        r.version !== revision?.version,
    )
    .sort((a, b) => b.version - a.version);
  // Other active drafts, mapped into the shared ReviewHeader's quick-nav shape.
  const headerOtherDrafts: ReviewHeaderOtherDraft[] = otherAttentionDrafts.map(
    (r) => ({
      key: String(r.version),
      version: r.version,
      title: r.title,
      badge: { version: r.version, status: r.status },
      onNavigate: () => setVersion(r.version),
    }),
  );

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
  const { reviewers, approvedAt } = useMemo<{
    reviewers: {
      id: string;
      status: "approved" | "changes-requested";
      timestamp: string;
      // The draft's content changed after this verdict was given (only
      // possible when the org doesn't reset reviews on change — otherwise
      // the verdict would have been cleared server-side).
      stale: boolean;
      // Display fallbacks from the baked review's event user, for reviewers
      // not present in the members map (e.g. API keys).
      name?: string;
      email?: string;
    }[];
    // Timestamp of the most recent *surviving* approval (retractions and
    // recalls invalidate earlier verdicts). Used to quantify how stale an
    // approval is in the divergence notice.
    approvedAt: string | null;
  }>(() => {
    const log = logData?.log;
    const sorted = log
      ? [...log].sort((a, b) =>
          (a.timestamp as unknown as string).localeCompare(
            b.timestamp as unknown as string,
          ),
        )
      : [];
    // Most recent content-mutating entry: anything that isn't conversation /
    // review lifecycle (those are in REVIEW_ACTIVITY_ACTIONS) or a
    // presentation-only edit. Verdicts older than this predate the changes
    // they vouched for.
    const PRESENTATION_ACTIONS = new Set(["edit comment", "edit title"]);
    const lastContentEditAt =
      sorted
        .filter(
          (e) =>
            !REVIEW_ACTIVITY_ACTIONS.has(e.action) &&
            !PRESENTATION_ACTIONS.has(e.action),
        )
        .map((e) => e.timestamp as unknown as string)
        .pop() ?? null;
    const isStale = (ts: string) =>
      (lastContentEditAt ?? null) !== null &&
      new Date(ts).getTime() < new Date(lastContentEditAt as string).getTime();
    const finish = (
      entries: {
        id: string;
        status: "approved" | "changes-requested";
        timestamp: string;
        // The model already demoted this verdict to a "-stale" variant.
        forceStale?: boolean;
        name?: string;
        email?: string;
      }[],
    ) => {
      const approvedTimestamps = entries
        .filter((v) => v.status === "approved" && !v.forceStale)
        .map((v) => v.timestamp)
        .sort();
      return {
        reviewers: entries.map(({ forceStale, ...v }) => ({
          ...v,
          stale: forceStale || isStale(v.timestamp),
        })),
        approvedAt: approvedTimestamps[approvedTimestamps.length - 1] ?? null,
      };
    };

    // Preferred source: the baked `reviews` field. It's authoritative — the
    // server clears it on recall, re-request, and reset-on-change — and it's
    // exactly what `validateFeatureRevision` policy hooks evaluate. Legacy
    // revisions (no baked field yet) fall back to replaying the log below.
    if (revision?.reviews) {
      return finish(
        revision.reviews.map((r) => ({
          id: r.userId,
          // "-stale" variants (verdicts demoted by later content edits) keep
          // their base verdict for display; `finish` re-derives the stale
          // flag from timestamps, which these always trip.
          status:
            r.status === "approved" || r.status === "approved-stale"
              ? ("approved" as const)
              : ("changes-requested" as const),
          forceStale:
            r.status === "approved-stale" ||
            r.status === "changes-requested-stale",
          timestamp: new Date(r.timestamp).toISOString(),
          name:
            r.user && "name" in r.user && r.user.name ? r.user.name : undefined,
          email:
            r.user && "email" in r.user && r.user.email
              ? r.user.email
              : undefined,
        })),
      );
    }

    if (!log) return { reviewers: [], approvedAt: null };
    // Replay the lifecycle chronologically so retractions (Undo Review by
    // the reviewer) and recalls (Recall Review by the author) properly
    // invalidate prior verdicts. Without this, a reviewer who pulls back
    // their approval would still appear listed with the stale verdict.
    const byUser = new Map<
      string,
      { status: "approved" | "changes-requested"; timestamp: string }
    >();
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
      const timestamp = entry.timestamp as unknown as string;
      if (entry.action === "Approved") {
        byUser.set(uid, { status: "approved", timestamp });
      } else if (entry.action === "Requested Changes") {
        byUser.set(uid, { status: "changes-requested", timestamp });
      } else if (entry.action === "Undo Review") {
        byUser.delete(uid);
      }
    }
    return finish(
      Array.from(byUser, ([id, v]) => ({
        id,
        status: v.status,
        timestamp: v.timestamp,
      })),
    );
  }, [logData, revision]);

  // User ID of whoever most recently submitted a "Review Requested" entry.
  // Drives the header attribution and (together with author/contributor
  // status) gates "Return to draft".
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
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const liveBaseInput = useMemo(
    () => featureToFeatureRevisionDiffInput(feature),
    [feature],
  );
  const toDiffInput = useCallback(
    (r: FeatureRevisionInterface): FeatureRevisionDiffInput =>
      revisionToFeatureRevisionDiffInput(r, liveBaseInput),
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
  // ── Unified auto-publish arming ──
  // A revision is "armed" (autoPublishOnApproval) in one of two mutually
  // exclusive modes: publish "when approved" (no date) or "on a specific date"
  // (scheduledPublishAt). The UI is a single checkbox plus a mode selector.
  const [autoPublishArmed, setAutoPublishArmed] = useState(
    !!revision?.autoPublishOnApproval,
  );
  const [publishMode, setPublishMode] = useState<"approve" | "date">(
    revision && isScheduledPublishPending(revision) ? "date" : "approve",
  );
  const [rebasing, setRebasing] = useState(false);
  const [experimentsStep, setExperimentsStep] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [secondaryLoading, setSecondaryLoading] = useState<
    "recall" | "undo" | null
  >(null);
  const [secondaryError, setSecondaryError] = useState<string | null>(null);
  const [actionsDropdownOpen, setActionsDropdownOpen] = useState(false);
  const publishAfterApproval = useRef(false);
  const checklistAfterApproval = useRef(false);
  const doSubmitRef = useRef<() => void>(() => {});
  const revisionLogRef = useRef<MutateLog>(null);

  // ── Scheduled (deferred) publish ──
  const scheduledPending = !!revision && isScheduledPublishPending(revision);
  const [scheduleDate, setScheduleDate] = useState<string>(
    revision?.scheduledPublishAt
      ? new Date(revision.scheduledPublishAt).toISOString()
      : "",
  );
  // The two underlying locks are surfaced as one checkbox + a scope selector
  // (mirrors the "Automatically publish [mode]" control). The scope is its own
  // state so the selector works even while the checkbox is off — picking a
  // scope then only records the preference. lockEdits = enabled; lockOthers =
  // enabled && scope === "feature" (feature scope is the superset).
  const [scheduleLockEnabled, setScheduleLockEnabled] = useState(
    !!revision?.scheduledPublishLockEdits ||
      !!revision?.scheduledPublishLockOthers,
  );
  const [scheduleLockScope, setScheduleLockScope] = useState<
    "draft" | "feature"
  >(revision?.scheduledPublishLockOthers ? "feature" : "draft");
  const scheduleLockEdits = scheduleLockEnabled;
  const scheduleLockOthers =
    scheduleLockEnabled && scheduleLockScope === "feature";
  // Admin-only: dangerously arm the scheduled publish so it fires without the
  // normal approval. Distinct from the "publish now" admin bypass — this one
  // belongs to the schedule and is what gets persisted as scheduledPublishBypassApproval.
  const [scheduleBypassApproval, setScheduleBypassApproval] = useState(
    !!revision?.scheduledPublishBypassApproval,
  );
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  // Once a schedule is armed (persisted), owners/admins see a read-only summary
  // (parity with reviewers) to avoid accidental edits. "Change" flips this on to
  // reveal the editable controls; canceling/unarming flips it back off.
  const [editingSchedule, setEditingSchedule] = useState(false);

  // The revision loads asynchronously and changes on every mutation, so re-sync
  // the unified arming UI whenever the persisted arming changes. Keyed on the
  // persisted field VALUES (not the revision object identity) so an in-progress,
  // not-yet-saved edit isn't clobbered when an auto-save's mutate() returns a new
  // revision object whose values match what we already have. Depending on object
  // identity here caused every checkbox to flicker on each toggle.
  useEffect(() => {
    setAutoPublishArmed(!!revision?.autoPublishOnApproval);
    setPublishMode(scheduledPending ? "date" : "approve");
    setScheduleDate(
      revision?.scheduledPublishAt
        ? new Date(revision.scheduledPublishAt).toISOString()
        : "",
    );
    setScheduleLockEnabled(
      !!revision?.scheduledPublishLockEdits ||
        !!revision?.scheduledPublishLockOthers,
    );
    setScheduleLockScope(
      revision?.scheduledPublishLockOthers ? "feature" : "draft",
    );
    setScheduleBypassApproval(!!revision?.scheduledPublishBypassApproval);
  }, [
    revision?.autoPublishOnApproval,
    revision?.scheduledPublishAt,
    revision?.scheduledPublishLockEdits,
    revision?.scheduledPublishLockOthers,
    revision?.scheduledPublishBypassApproval,
    scheduledPending,
  ]);

  // Collapse back to the read-only schedule summary when switching revisions.
  // Keyed on version only (not every mutation) so an in-progress edit isn't
  // collapsed when an auto-saved schedule change re-fetches the revision.
  useEffect(() => {
    setEditingSchedule(false);
  }, [revision?.version]);

  // ── Sub-tabs ──
  // "Overview" (human-readable changes + review activity) vs "Changes" (JSON
  // diffs + full timeline). Reflected in the URL hash as `#review,overview` /
  // `#review,changes` so the view is deep-linkable. With no explicit sub-tab in
  // the URL, a revision in review defaults to Changes so reviewers land on the
  // diff; otherwise Conversation. (Mirrors the generic Review & Publish tab.)
  const [urlHash, setUrlHash] = useURLHash();
  const subTabHash = urlHash?.split(",")[1];
  const subTab: ReviewSubTab =
    subTabHash === "changes"
      ? "changes"
      : subTabHash === "overview"
        ? "overview"
        : revision?.status === "pending-review" ||
            revision?.status === "changes-requested"
          ? "changes"
          : "overview";
  const setSubTab = useCallback(
    (t: ReviewSubTab) => {
      setUrlHash(t === "changes" ? "review,changes" : "review,overview");
    },
    [setUrlHash],
  );
  // Diff-ref widgets broadcast a sub-tab request before scrolling (their
  // line-level targets only exist on the Changes tab).
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail === "overview" || detail === "changes") setSubTab(detail);
    };
    window.addEventListener(REVIEW_SUBTAB_EVENT, handler);
    return () => window.removeEventListener(REVIEW_SUBTAB_EVENT, handler);
  }, [setSubTab]);

  // ── Diff comment anchors ──
  // Comments whose markdown carries a visible ref token (`diff:rules:R12`)
  // resolve to markers in the JSON diff gutters. Both log consumers (the
  // timeline and the reviewers widget) share the SWR key, so one mutate
  // refreshes everything.
  const diffCommentAnchors = useMemo(
    () => buildAnchoredCommentMap(logData?.log ?? []),
    [logData],
  );
  const mutateAllLogs = useCallback(async () => {
    await mutateReviewLog();
    await revisionLogRef.current?.mutateLog();
  }, [mutateReviewLog]);
  const diffComments = useMemo<DiffCommentsProps>(
    () => ({
      anchors: diffCommentAnchors,
      // New comments only on active drafts when the user can review drafts.
      // Existing markers stay visible (read-only) on published / discarded
      // revisions, and when the user lacks canReviewFeatureDrafts.
      onSubmitNew:
        isActiveDraft && revision && canCommentOnDraft
          ? async (text: string) => {
              await apiCall(
                `/feature/${feature.id}/${revision.version}/comment`,
                { method: "POST", body: JSON.stringify({ comment: text }) },
              );
              await mutateAllLogs();
              scrollToLatestRevisionLogEntry();
            }
          : undefined,
    }),
    [
      diffCommentAnchors,
      isActiveDraft,
      revision,
      canCommentOnDraft,
      apiCall,
      feature.id,
      mutateAllLogs,
    ],
  );

  // Raw merge state — no client-side conflict resolutions applied. Drives all
  // page-level UI (divergence notice, publish gating, state machine) and the
  // publish/request payloads: the page must keep treating the draft as
  // conflicted until a rebase is actually persisted server-side.
  const mergeResult = useMemo(() => {
    if (!revision || !baseRevision || !liveRevision) return null;
    return autoMerge(
      liveRevisionFromFeature(liveRevision, feature),
      fillRevisionFromFeature(baseRevision, feature),
      revision,
      envIds,
      {},
    );
  }, [revision, baseRevision, liveRevision, envIds, feature]);

  // Strategies-applied preview for the Resolve Conflicts modal. Becomes
  // successful once every conflict has a chosen strategy, which enables the
  // modal's Next → Review Changes → Update Draft flow and forms the rebase
  // payload. Never leaks into page-level state — only the persisted rebase
  // clears the conflict for the rest of the surface.
  const resolvedMergeResult = useMemo(() => {
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
  // Parallel to the ramp lock: another draft of this feature has a pending
  // scheduled publish that locks publishing of other drafts. Blocks publishing
  // THIS revision (the scheduled sibling is excluded so it can still publish).
  const lockingScheduledSibling = findPublishLockingScheduledRevision(
    revisions,
    revision?.version,
  );
  const featureLockedBySchedule = !!lockingScheduledSibling;

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

  const autopublishOnApproval =
    getFeatureAutopublishOnApproval(requireReviewSettings, feature) &&
    hasCommercialFeature("require-approvals");
  const revisionAutoPublishArmed = !!revision?.autoPublishOnApproval;

  const isReviewRequester =
    !!userId && !!reviewRequesterId && userId === reviewRequesterId;

  // Only the draft / review-request owner can edit the arming; others see a
  // read-only summary when armed (matching main's auto-publish-on-approval rule).
  const isArmingOwner =
    permissionsUtil.canPublishFeature(feature, envIds) &&
    (revision?.status === "draft" || isReviewRequester);
  const hasScheduledRevisions = hasCommercialFeature("scheduled-revisions");
  // "when approved" only makes sense before approval — once approved it would
  // just publish now (which Publish already does), so approved revisions only
  // offer "on a date".
  const canArmWhenApproved =
    autopublishOnApproval && isArmingOwner && revision?.status !== "approved";
  // Arming/editing a dated schedule needs only publish authority — not draft /
  // review-request ownership — matching the backend `canScheduleFeaturePublish`
  // gate, so a reviewer with publish permission can manage the schedule from the
  // UI. The premium (`scheduled-revisions`) gate is applied at render.
  const canArmOnDate = permissionsUtil.canPublishFeature(feature, envIds);
  const effectivePublishMode: "approve" | "date" = canArmWhenApproved
    ? publishMode
    : "date";

  // A schedule armed by an admin via the bypass-approval override is locked:
  // nobody (not even the arming admin) can edit it inline — it can only be
  // canceled and re-armed. Anyone with publish authority may cancel it, which
  // clears the bypass flag (reverts the admin override).
  const scheduleArmedByAdmin =
    scheduledPending && !!revision?.scheduledPublishBypassApproval;
  const canCancelAdminSchedule =
    scheduleArmedByAdmin && permissionsUtil.canPublishFeature(feature, envIds);

  const canManageAutoPublish = canArmWhenApproved || canArmOnDate;
  // Admin-armed schedules render read-only for everyone, so route them through
  // the read-only card (with an optional Cancel) rather than the editable/owner
  // controls.
  const showAutoPublishReadonly =
    (revisionAutoPublishArmed && !canManageAutoPublish) || scheduleArmedByAdmin;
  // The read-only card (with Cancel + Change) is reserved for a dated schedule,
  // guarding against accidental edits. "Auto-publish when approved" is just a
  // toggle, so owners keep the plain editable checkbox.
  const showAutoPublishEditable =
    canManageAutoPublish &&
    !scheduleArmedByAdmin &&
    (!scheduledPending || editingSchedule);
  const showManagerScheduleReadonly =
    canManageAutoPublish &&
    scheduledPending &&
    !editingSchedule &&
    !scheduleArmedByAdmin;

  // Status card for a dated schedule. Used by both reviewer and owner views so
  // they read identically; onChange/onCancel are omitted for viewers.
  const renderScheduleCard = ({
    onChange,
    onCancel,
    note,
  }: {
    onChange?: () => void;
    onCancel?: () => void;
    note?: string;
  }) => {
    if (!revision || !scheduledPending || !revision.scheduledPublishAt)
      return null;
    // Locks take effect only once approved; until then they're pending.
    const lockActive = isScheduledPublishLockActive(revision);
    const lockEdits = !!revision.scheduledPublishLockEdits;
    const lockOthers = !!revision.scheduledPublishLockOthers;
    const hasLocks = lockEdits || lockOthers;
    // Entity-agnostic, explicit wording shared with ScheduledPublishControl so
    // both surfaces read identically: lockEdits freezes this draft's edits,
    // lockOthers freezes publishing of the feature's other drafts.
    const lockTargets =
      lockOthers && lockEdits
        ? "this draft and other drafts of this feature"
        : lockOthers
          ? "other drafts of this feature"
          : "this draft";
    return (
      <NoticeBanner
        icon={<PiClockFill />}
        iconColor="violet"
        title="Scheduled to publish"
        body={
          <>
            {format(new Date(revision.scheduledPublishAt as Date), "PPp")}
            {lockActive ? "" : " · pending approval"}
          </>
        }
        footer={
          <>
            {hasLocks && (
              <HelperText status="warning" size="sm" icon={<PiLock />} mt="2">
                {lockActive ? "Locks " : "Will lock "}
                {lockTargets}
              </HelperText>
            )}
            {revision.scheduledPublishLastError && (
              <HelperText status="error" size="sm" mt="2">
                Publish is stuck and keeps retrying:{" "}
                {revision.scheduledPublishLastError}
              </HelperText>
            )}
            {note && (
              <HelperText status="info" size="sm" mt="2">
                {note}
              </HelperText>
            )}
          </>
        }
        action={
          onChange || onCancel ? (
            <Flex gap="3" align="center">
              {onCancel && (
                <Button
                  variant="ghost"
                  color="red"
                  disabled={savingSchedule}
                  onClick={onCancel}
                >
                  Cancel schedule
                </Button>
              )}
              {onChange && (
                <Button
                  variant="outline"
                  disabled={savingSchedule}
                  onClick={onChange}
                >
                  Change
                </Button>
              )}
            </Flex>
          ) : undefined
        }
      />
    );
  };

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

  // How many revisions were published after the point this draft was
  // approved against. Quantifies the stale-approval notice ("live has
  // advanced 2 revisions since"). Null for legacy approvals that predate
  // approvedBaseVersion tracking.
  const revisionsSinceApproval = useMemo<number | null>(() => {
    const approvedBase = revision?.approvedBaseVersion ?? null;
    if (approvedBase === null) return null;
    return revisions.filter(
      (r) =>
        r.status === "published" &&
        r.version > approvedBase &&
        r.version <= feature.version,
    ).length;
  }, [revisions, revision, feature.version]);

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
  // `experiments` is derived from the async `experimentsList` prop, so the
  // useState initializer can run before it arrives. Reconcile: auto-select
  // newly-appearing experiments and drop ones that vanished, while preserving
  // explicit user deselections of already-known ids.
  const knownExperimentIdsRef = useRef<Set<string>>(
    new Set(experiments.map((e) => e.id)),
  );
  useEffect(() => {
    const currentIds = new Set(experiments.map((e) => e.id));
    const known = knownExperimentIdsRef.current;
    const newlyAdded = [...currentIds].filter((id) => !known.has(id));
    knownExperimentIdsRef.current = currentIds;
    setSelectedExperiments((prev) => {
      const next = new Set([...prev].filter((id) => currentIds.has(id)));
      newlyAdded.forEach((id) => next.add(id));
      return next.size === prev.size && [...next].every((id) => prev.has(id))
        ? prev
        : next;
    });
  }, [experiments]);

  const selectedImmediateCount = immediateStartExperiments.filter((e) =>
    selectedExperiments.has(e.id),
  ).length;
  const selectedScheduledCount = scheduledExperiments.filter((e) =>
    selectedExperiments.has(e.id),
  ).length;
  const onlyScheduledSelected =
    selectedImmediateCount === 0 && selectedScheduledCount > 0;

  const hasChecklistStep = experiments.length > 0;

  const openChecklistStep = useCallback(() => {
    checklistStateRef.current.clear();
    setChecklistBlocked(false);
    setExperimentsStep(true);
  }, []);

  const checklistStateRef = useRef<
    Map<string, { failedRequired: boolean; loading: boolean }>
  >(new Map());
  const [checklistBlocked, setChecklistBlocked] = useState(false);
  // Checklist results are per-revision; clear them when the user switches
  // revisions so stale failures can't block publishing a clean draft.
  useEffect(() => {
    checklistStateRef.current.clear();
    setChecklistBlocked(false);
  }, [version]);
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
  // Three modes, picked by what's available:
  //  - merge success: diff against the merged result (what publish would do).
  //    `draftDiffInput` is intentionally sparse — only fields the merge
  //    touched — so the sectional diff above reflects net intent.
  //  - merge conflict: the merged result isn't computable yet, so fall back
  //    to the raw draft revision so reviewers can still see what's at stake
  //    (draft vs live, with conflicting items marked by the conflict modal).
  //  - no revision: shouldn't happen at this point, but keep a no-op shape.
  const draftDiffInput: FeatureRevisionDiffInput = mergeResult?.success
    ? mergeResultToDiffInput(mergeResult.result, currentRevisionData)
    : revision
      ? revisionToFeatureRevisionDiffInput(revision, currentRevisionData)
      : currentRevisionData;
  const resultDiffs = useFeatureRevisionDiff({
    current: currentRevisionData,
    draft: draftDiffInput,
  });
  // Preview diffs for the conflict modal's "Review Changes" step: what the
  // draft will contain once the chosen resolutions are applied and the
  // rebase runs.
  const resolvedDraftDiffInput: FeatureRevisionDiffInput =
    resolvedMergeResult?.success
      ? mergeResultToDiffInput(resolvedMergeResult.result, currentRevisionData)
      : draftDiffInput;
  const resolvedResultDiffs = useFeatureRevisionDiff({
    current: currentRevisionData,
    draft: resolvedDraftDiffInput,
  });
  // For the whole-object "Raw JSON" view we need a complete object, otherwise
  // sparse merge-result fields look like deletions — layer the diff input
  // over the current revision so unchanged fields are present on both sides.
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
    setSubmitError(null);
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
    } catch (e) {
      await mutate();
      setSubmitError(e.message || "Failed to update from live");
    } finally {
      setRebasing(false);
    }
  };

  const pageWrapper = (children: React.ReactNode) => (
    <Box className="contents container-fluid pagecontents pt-4">{children}</Box>
  );

  // After a reviewer chooses "Submit and Publish", advance to the pre-launch
  // checklist when linked experiments require it; otherwise run publish once
  // the revision is approved.
  useEffect(() => {
    if (revision?.status !== "approved") return;

    if (checklistAfterApproval.current) {
      checklistAfterApproval.current = false;
      openChecklistStep();
      return;
    }

    if (publishAfterApproval.current) {
      publishAfterApproval.current = false;
      doSubmitRef.current();
    }
  }, [revision?.status, openChecklistStep]);

  // The selected version doesn't exist yet (still loading) or ?v= is invalid.
  if (!revision) {
    return pageWrapper(
      <Callout status="info">
        Select a revision from the dropdown above to review.
        {onClose && (
          <Box mt="2">
            <Button color="inherit" variant="soft" onClick={() => onClose()}>
              Back to Overview
            </Button>
          </Box>
        )}
      </Callout>,
    );
  }

  // ── Shared left column (both the draft flow and the read-only review).
  // Overview: notes + height-capped human-readable changes + the review
  // activity timeline. Changes: JSON/Full JSON diffs (with the comment
  // gutter) + the full edit timeline. Both end with the comment composer. ──
  const renderLeftColumn = (
    diffs: FeatureRevisionDiff[],
    raw: { before: unknown; after: unknown },
  ) => (
    <>
      {subTab === "overview" && (
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
      )}

      <Box className="appbox" mb="0">
        {subTab === "overview" ? (
          <DiffContent
            diffs={diffs}
            feature={feature}
            outOfOrderWarning={false}
            raw={raw}
            variant="card"
            formats={["formatted"]}
            collapsedMaxHeight={250}
            // Strictly human-readable: no JSON fallback, no export button —
            // both live on the Changes tab.
            jsonFallback={false}
            showCopyAs={false}
          />
        ) : (
          <DiffContent
            diffs={diffs}
            feature={feature}
            outOfOrderWarning={false}
            raw={raw}
            variant="card"
            formats={["json", "raw"]}
            diffComments={diffComments}
            // The Conversation tab already carries the summary heading + badges;
            // here we go straight to the diffs.
            showSummaryHeader={false}
          />
        )}
      </Box>

      {/* The timeline's vertical line runs straight out of the bottom of
            the summary card above (no gap, no separator). */}
      <Box mb="4">
        <Revisionlog
          feature={feature}
          revision={revision}
          ref={revisionLogRef}
          onRevisionMutate={mutate}
          // Overview foregrounds the conversation: comments, verdicts, and
          // lifecycle events. Granular content-edit entries collapse into
          // per-run "N other events" toggles.
          collapseFilter={
            subTab === "overview"
              ? (l) => REVIEW_ACTIVITY_ACTIONS.has(l.action)
              : undefined
          }
        />

        {/* Composer sits below the timeline — entries are chronological
              (newest at the bottom), so new comments appear right above it.
              Your avatar + an "Add a comment" header sit above the input,
              aligned with the timeline's comment cards. */}
        {isActiveDraft && canCommentOnDraft && (
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
                size="md"
              />
            </Box>
            <Box flexGrow="1" style={{ minWidth: 0 }}>
              {/* Fixed-height row matching the 32px md avatar so the label
                    centers against it */}
              <Flex align="center" style={{ height: 32 }}>
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
                  await mutateAllLogs();
                  scrollToLatestRevisionLogEntry();
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
  // System actors (e.g. ramp schedules) stamp their own id into createdBy and
  // contributors; those aren't org members, so exclude them from the people
  // rows and render a "Generated by" line instead (same as the overview page).
  const systemCreator =
    revision.createdBy?.type === "system" ? revision.createdBy : null;
  const authorId =
    !systemCreator &&
    revision.createdBy &&
    "id" in revision.createdBy &&
    revision.createdBy.id
      ? revision.createdBy.id
      : undefined;
  const contribIds = (revision.contributors ?? []).filter(
    (id) => id !== systemCreator?.id,
  );
  const contributorIds =
    authorId && !contribIds.includes(authorId)
      ? [authorId, ...contribIds]
      : contribIds;
  const generatedByRow = systemCreator ? (
    <Box mb="3">
      <Metadata
        label="Generated by"
        value={
          <em>
            {systemCreator.subtype === "ramp-schedule"
              ? "ramp schedule"
              : "system"}
          </em>
        }
      />
    </Box>
  ) : null;

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
    // The actions-widget header reflects the review lifecycle, not deployment
    // state — "Live"/"Locked" aren't lifecycle stages, so terminal revisions
    // all read as "Published" here. Discarded stays (it can be reopened for
    // review). The title badge above still shows the precise live/locked state.
    const headerStatus = isDiscarded ? "discarded" : ("published" as const);
    const headerStatusColor = revisionStatusColor(headerStatus);
    const headerStatusLabel = isDiscarded ? "Discarded" : "Published";
    const headerStatusIcon = isDiscarded ? (
      revisionStatusIcon("discarded")
    ) : (
      <PiGitMergeBold />
    );
    const headerTitle =
      revision.title?.trim() ||
      revision.comment?.trim() ||
      `Revision ${revision.version}`;
    const baseV = readonlyBaseRevision?.version;

    // Errors surface inside the confirm modal via ModalForm's error handling.
    const doReopen = async () => {
      await apiCall(`/feature/${feature.id}/${revision.version}/reopen`, {
        method: "POST",
      });
      await mutate();
    };

    const readonlyHeader = (
      <ReviewHeader
        title={headerTitle}
        badgeStatus={status}
        version={revision.version}
        liveVersion={feature.version}
        lifecycle={isDiscarded ? "discarded" : "merged"}
        baseVersion={baseV}
        mergedIntoVersion={baseV}
        publishedDate={revision.datePublished ?? undefined}
        discardedDate={isDiscarded ? revision.dateUpdated : undefined}
        otherDrafts={headerOtherDrafts}
        subTab={subTab}
        setSubTab={setSubTab}
        onCompareRevisions={onCompareRevisions}
      />
    );

    const readonlyActionsColumn = (
      <Box
        className="appbox"
        style={{ position: "sticky", top: 90, overflow: "hidden" }}
      >
        {/* Status header – lifecycle status (Published / Discarded), not the
            deployment state (Live / Locked). */}
        <Flex
          align="center"
          px="4"
          style={{
            background: `var(--${headerStatusColor}-a3)`,
            borderBottom: "1px solid var(--gray-a4)",
            minHeight: 40,
          }}
        >
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
        </Flex>

        <Box p="4">
          {/* People: same widgets as the draft flow. Useful on locked / live
              / discarded revisions for attribution and audit context. */}
          {generatedByRow}
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
                {reviewers.map(({ id, status, timestamp, stale, ...r }) => {
                  const u = users.get(id);
                  const name = u?.name || r.name || "";
                  const email = u?.email || r.email || "";
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
              variant="outline"
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

  // Publishing is currently blocked (merge conflict, required rebase/divergence,
  // ramp lockdown, or nothing to publish). Used to suppress the reviewer's
  // one-step "Submit and Publish" options — approving still works, but the
  // publish half can't proceed, so we shouldn't offer it.
  const reviewerPublishBlocked =
    !mergeResult.success ||
    !hasChanges ||
    !(governance ? governance.canPublish : true) ||
    featureLockedByRamp ||
    featureLockedBySchedule;

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
    isReviewRequester,
    isContributor: !!userId && contributorIds.includes(userId),
    isReviewer: !!userId && reviewers.some((r) => r.id === userId),
    adminPublish,
    hasSelectedExperiments: selectedExperiments.size > 0,
    onlyScheduledSelected,
    experimentsStep,
    featureLockedByRamp,
    featureLockedBySchedule,
    checklistBlocked,
    governanceCanPublish: governance ? governance.canPublish : true,
  });

  const doSubmit = async () => {
    setSubmitError(null);
    try {
      switch (state.submitAction) {
        case "next-experiments":
          openChecklistStep();
          return;
        case "request-review": {
          setSubmitting(true);
          const dateArmed =
            autoPublishArmed &&
            effectivePublishMode === "date" &&
            !!scheduleDate;
          await apiCall(`/feature/${feature.id}/${revision.version}/request`, {
            method: "POST",
            body: JSON.stringify({
              mergeResultSerialized: JSON.stringify(mergeResult),
              comment,
              autoPublishOnApproval:
                autoPublishArmed && effectivePublishMode === "approve",
              scheduledPublishAt: dateArmed ? scheduleDate : null,
              scheduledPublishLockEdits: scheduleLockEdits,
              scheduledPublishLockOthers: scheduleLockOthers,
            }),
          });
          // The review log drives reviewRequesterId (and thus the "Retract
          // review request" affordance) — refresh it alongside the revision.
          await Promise.all([mutate(), mutateReviewLog()]);
          return;
        }
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
  doSubmitRef.current = doSubmit;

  // Persist (or, for drafts, stage) the "publish when approved" arming.
  const doToggleAutoPublish = async (enabled: boolean) => {
    setAutoPublishArmed(enabled);
    if (revision.status !== "draft") {
      try {
        await apiCall(
          `/feature/${feature.id}/${revision.version}/toggle-auto-publish`,
          {
            method: "POST",
            body: JSON.stringify({ enabled }),
          },
        );
        await mutate();
      } catch (e) {
        setAutoPublishArmed(!enabled);
      }
    }
  };

  // Persist the schedule. Called on every date/lock change (no separate save
  // step), so the full armed state is always saved and visible to reviewers.
  const persistSchedule = async (
    date: string,
    lockEdits: boolean,
    lockOthers: boolean,
    bypassApproval = false,
  ): Promise<boolean> => {
    if (!date || !revision) return false;
    setScheduleError(null);
    setSavingSchedule(true);
    try {
      await apiCall(
        `/feature/${feature.id}/${revision.version}/schedule-publish`,
        {
          method: "POST",
          body: JSON.stringify({
            scheduledPublishAt: date,
            lockEdits,
            lockOthers,
            bypassApproval,
          }),
        },
      );
      await mutate();
      return true;
    } catch (e) {
      setScheduleError(e.message || "Could not schedule publish");
      return false;
    } finally {
      setSavingSchedule(false);
    }
  };

  // A review-required draft stages the schedule locally and arms it on "Request
  // Review". Otherwise (review pending/later, or no-approval changes) it persists
  // immediately. An admin engaging the bypass override also persists immediately
  // — they're dangerously arming a schedule rather than entering the review flow.
  const schedulePersistsImmediately =
    revision?.status !== "draft" || !requireReviews || scheduleBypassApproval;

  // The admin bypass toggle is only meaningful when this revision would
  // otherwise need approval to publish (review required and not yet approved).
  const canBypassScheduleApproval =
    canAdminPublish && requireReviews && revision?.status !== "approved";

  // Single source of truth for persisting the current schedule config.
  const persistCurrentSchedule = (
    lockEdits: boolean,
    lockOthers: boolean,
    bypassApproval: boolean,
    persists = schedulePersistsImmediately,
  ) => {
    if (autoPublishArmed && scheduleDate && (persists || scheduledPending)) {
      persistSchedule(scheduleDate, lockEdits, lockOthers, bypassApproval);
    }
  };

  const onScheduleDateChange = (date: string) => {
    setScheduleDate(date);
    if (autoPublishArmed && date && schedulePersistsImmediately) {
      persistSchedule(
        date,
        scheduleLockEdits,
        scheduleLockOthers,
        scheduleBypassApproval,
      );
    }
  };

  const onScheduleLockToggle = (value: boolean) => {
    setScheduleLockEnabled(value);
    persistCurrentSchedule(
      value,
      value && scheduleLockScope === "feature",
      scheduleBypassApproval,
    );
  };

  const onScheduleLockScopeChange = (scope: "draft" | "feature") => {
    setScheduleLockScope(scope);
    // Mirror the publish-mode selector: changing scope while the lock is off
    // only records the preference; it doesn't enable the lock.
    if (scheduleLockEnabled) {
      persistCurrentSchedule(true, scope === "feature", scheduleBypassApproval);
    }
  };

  const onScheduleBypassChange = (value: boolean) => {
    setScheduleBypassApproval(value);
    // Enabling bypass also flips schedulePersistsImmediately true for a
    // review-required draft, so recompute persistence with the new value.
    const persists = revision?.status !== "draft" || !requireReviews || value;
    persistCurrentSchedule(
      scheduleLockEdits,
      scheduleLockOthers,
      value,
      persists,
    );
  };

  const doClearSchedule = async () => {
    if (!revision) return;
    setScheduleError(null);
    setSavingSchedule(true);
    try {
      await apiCall(
        `/feature/${feature.id}/${revision.version}/schedule-publish`,
        {
          method: "POST",
          body: JSON.stringify({ scheduledPublishAt: null }),
        },
      );
      await mutate();
      setScheduleDate("");
    } catch (e) {
      setScheduleError(e.message || "Could not cancel schedule");
    } finally {
      setSavingSchedule(false);
    }
  };

  // Arming uses the mode currently chosen in the dropdown.
  const doSetAutoPublishArmed = async (armed: boolean) => {
    setScheduleError(null);
    if (!armed) {
      setAutoPublishArmed(false);
      setEditingSchedule(false);
      if (scheduledPending) {
        await doClearSchedule();
      } else {
        await doToggleAutoPublish(false);
      }
      return;
    }
    // Keep the editable controls open while configuring a freshly armed schedule.
    setEditingSchedule(true);
    if (effectivePublishMode === "approve") {
      await doToggleAutoPublish(true);
    } else {
      setPublishMode("date");
      setAutoPublishArmed(true);
      // Revert the optimistic check if the immediate save fails, so the box
      // doesn't read as armed when nothing was persisted.
      if (scheduleDate && schedulePersistsImmediately) {
        const ok = await persistSchedule(
          scheduleDate,
          scheduleLockEdits,
          scheduleLockOthers,
          scheduleBypassApproval,
        );
        if (!ok) {
          setAutoPublishArmed(false);
          setEditingSchedule(false);
        }
      }
    }
  };

  // Switch arming modes. When not yet armed this only records the preference.
  const doSetPublishMode = async (mode: "approve" | "date") => {
    setScheduleError(null);
    setPublishMode(mode);
    if (!autoPublishArmed) return;
    if (mode === "approve") {
      if (scheduledPending) await doClearSchedule();
      await doToggleAutoPublish(true);
    } else if (scheduleDate && schedulePersistsImmediately) {
      await persistSchedule(
        scheduleDate,
        scheduleLockEdits,
        scheduleLockOthers,
        scheduleBypassApproval,
      );
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
                // The server recomputes autoMerge with these strategies and
                // byte-compares — so send the strategies-applied result.
                mergeResultSerialized: JSON.stringify(resolvedMergeResult),
                strategies,
              }),
            });
          } catch (e) {
            await mutate();
            throw e;
          }
          await mutate();
          // Don't let stale picks silently auto-resolve a future conflict
          // on the same key.
          setStrategies({});
        }}
        cta={conflictStep === 1 ? "Update Draft" : "Next"}
        ctaEnabled={!!resolvedMergeResult?.success}
        close={() => {
          setResolveConflicts(false);
          setConflictStep(0);
        }}
        closeCta="Cancel"
        size="max"
      >
        <Page
          display="Fix Conflicts"
          enabled
          validate={async () => {
            if (!resolvedMergeResult?.success) {
              throw new Error("Please resolve all conflicts first");
            }
          }}
        >
          <Box
            mb="4"
            style={{ maxWidth: 800, margin: "0 auto var(--space-4)" }}
          >
            <Callout status="info" icon={<PiGitMergeBold size={18} />}>
              Your draft is based on an older version, and the live version has
              since been published with conflicting changes. Resolve each
              conflict below, then click{" "}
              <Text as="span" weight="medium">
                Update Draft
              </Text>{" "}
              to rebase your draft onto the current live version.
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
              {resolvedResultDiffs
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

  // Shared by the no-changes empty state and the actions column kebab — the
  // only two places an active draft can be discarded from.
  const canDiscardDraft = permissionsUtil.canManageFeatureDrafts(feature);
  const discardConfirmModal = confirmDiscard ? (
    <ModalStandard
      trackingEventModalType="discard-feature-revision"
      open={true}
      header="Discard Draft"
      cta="Discard"
      ctaColor="red"
      close={() => setConfirmDiscard(false)}
      submit={async () => {
        try {
          await apiCall(`/feature/${feature.id}/${revision.version}/discard`, {
            method: "POST",
          });
        } finally {
          await mutate();
        }
      }}
    >
      Are you sure you want to discard this draft? This action cannot be undone.
    </ModalStandard>
  ) : null;

  // Hoisted out of the footer render so the read-only schedule card (shown to
  // reviewers/non-managers) can tell whether the arming control will already
  // render it below the rebase/divergence notice — and avoid showing it twice.
  // Step actions precede publish (Request Review / Submit Review / Next).
  const isStepAction =
    state.hasSubmit &&
    state.submitAction !== "publish" &&
    state.submitAction !== "none" &&
    state.submitAction !== "next-experiments";
  const continueToPublish =
    state.submitAction === "next-experiments" && !experimentsStep;

  // What's blocking publish (ignoring adminPublish so it stays visible while the
  // checkbox is unchecked). `overridable` gates the admin-bypass checkbox.
  type BlockInfo = { overridable: boolean } | null;
  const blockInfo: BlockInfo = (() => {
    if (!mergeResult.success) return { overridable: false };
    if (!hasChanges) return { overridable: false };
    if (!hasPublishPermission) return { overridable: false };
    if (
      requireReviews &&
      !adminPublish &&
      ["draft", "pending-review", "changes-requested"].includes(revision.status)
    )
      return { overridable: true };
    if (!adminPublish && !governance?.canPublish) return { overridable: true };
    if (!adminPublish && featureLockedByRamp) return { overridable: true };
    if (!adminPublish && featureLockedBySchedule) return { overridable: true };
    return null;
  })();

  // Publish section (divider, admin-bypass, Publish button) is hidden for
  // not-yet-approved drafts unless an admin can bypass.
  const adminCanBypassNow =
    canAdminPublish &&
    mergeResult.success &&
    (blockInfo?.overridable || adminPublish);
  const showPublishSection =
    state.submitAction === "publish" || continueToPublish || adminCanBypassNow;
  // The arming control (and thus a dated schedule card) renders in either the
  // step block or the publish section. When neither shows, the read-only card
  // falls back to the summary block above.
  const armingRendersBelow = isStepAction || showPublishSection;

  // Hard merge conflicts no longer short-circuit the page: keep the
  // two-column layout so reviewers can still see draft-vs-live changes
  // alongside a "Fix conflicts" CTA in the actions column.

  // ── Full-width page header: big title, status badge, and a
  // one-line summary of which revision merges into which. We surface the
  // review requester once a review has actually been requested; otherwise we
  // just describe what would be merged. ──
  // Match the status colors/labels used by the revision selector badge.
  const reviewRequested =
    requireReviews &&
    (revision.status === "pending-review" ||
      revision.status === "approved" ||
      revision.status === "changes-requested");
  // Attribute the request to whoever actually clicked "Request review" (from
  // the review log — the same source that feeds the "Return to draft" gate).
  // The revision author is only a fallback while the log loads, since the
  // requester is often a different person than the author.
  const requesterId = reviewRequesterId || authorId;
  const requester = requesterId ? users.get(requesterId) : undefined;
  const requesterName = requester?.name || requester?.email || "";
  const headerTitle =
    revision.title?.trim() ||
    revision.comment?.trim() ||
    `Revision ${revision.version}`;

  const mergeHeader = (
    <ReviewHeader
      title={headerTitle}
      badgeStatus={revision.status}
      version={revision.version}
      liveVersion={feature.version}
      baseVersion={revision.baseVersion}
      reviewRequesterName={
        reviewRequested && requesterName ? requesterName : undefined
      }
      lifecycle="active"
      otherDrafts={headerOtherDrafts}
      subTab={subTab}
      setSubTab={setSubTab}
      onCompareRevisions={onCompareRevisions}
      hideSubTabs={experimentsStep}
    />
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
            <PreLaunchChecklistForDraftFeature
              experiment={experiment}
              feature={feature}
              mutateExperiment={mutate}
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
          {revisionStatusIcon(revision.status) && (
            <Box style={{ fontSize: 18, lineHeight: 1, display: "flex" }}>
              {revisionStatusIcon(revision.status)}
            </Box>
          )}
          <Heading as="h4" size="small">
            <span style={{ color: `var(--${statusColor}-11)` }}>
              {revisionStatusLabel(revision.status)}
            </span>
          </Heading>
        </Flex>

        {(state.canRecallReview || state.canUndoReview || canDiscardDraft) && (
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
                    Return to draft state
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
                {canDiscardDraft && (
                  <DropdownMenuItem
                    color="red"
                    disabled={secondaryLoading !== null}
                    onClick={() => {
                      setActionsDropdownOpen(false);
                      setConfirmDiscard(true);
                    }}
                  >
                    Discard draft
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
        {generatedByRow}
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

        {requireReviews &&
          (reviewers.length > 0 || revision.status === "pending-review") && (
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
              {reviewers.length === 0 &&
                revision.status === "pending-review" && (
                  <Text size="small" color="text-mid" as="div">
                    No reviews yet.
                  </Text>
                )}
              <Flex direction="column" gap="2">
                {reviewers.map(({ id, status, timestamp, stale, ...r }) => {
                  const u = users.get(id);
                  const name = u?.name || r.name || "";
                  const email = u?.email || r.email || "";
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

        {!experimentsStep &&
          (approved || !requireReviews) &&
          renderExperimentSelection()}

        <Box mt="6">
          {/* The poller gave up on this draft's scheduled publish (cleared on
              cancel/re-arm). Shown to every viewer — matches the generic
              ScheduledPublishControl notice. */}
          {isActiveDraft && revision?.scheduledPublishGaveUpAt && (
            <HelperText status="error" size="sm" mb="3">
              Could not publish
              {revision.scheduledPublishLastError
                ? `: ${revision.scheduledPublishLastError}`
                : "."}
            </HelperText>
          )}

          {/* Read-only arming summary for reviewers / non-managers. The dated
              schedule card renders with the arming control below the rebase
              notice when a publish/step section exists; here it's only a
              fallback for when neither section is shown (e.g. pending review). */}
          {showAutoPublishReadonly &&
            revision &&
            (scheduledPending ? (
              !armingRendersBelow &&
              renderScheduleCard(
                scheduleArmedByAdmin
                  ? {
                      onCancel: canCancelAdminSchedule
                        ? () => doSetAutoPublishArmed(false)
                        : undefined,
                      note: "Armed by an admin (approval bypassed). Cancel and re-arm to change it.",
                    }
                  : {},
              )
            ) : (
              // "When approved" is just a toggle — show a disabled checkbox.
              <Checkbox
                label="Automatically publish when approved"
                weight="regular"
                disabled
                value={true}
                setValue={() => {}}
              />
            ))}

          {/* Submit review — reviewer action, opens the comment/decision popover */}
          {canReview && isPendingReview && !approved && (
            <Flex direction="column" gap="3">
              <ReviewCommentPopover
                submitUrl={`/feature/${feature.id}/${revision.version}/submit-review`}
                storageKey={`review-comment:${feature.id}:${revision.version}`}
                allowPublishOnApprove={autopublishOnApproval}
                autoPublishArmed={revisionAutoPublishArmed}
                autoPublishScheduled={scheduledPending}
                canReviewerPublish={hasPublishPermission}
                publishBlocked={reviewerPublishBlocked}
                publishHasMoreSteps={hasChecklistStep}
                isBlockedContributor={!!isBlockedContributor}
                onSuccess={async (opts) => {
                  let publishedViaArming = false;
                  if (opts?.publish) {
                    if (hasChecklistStep) {
                      checklistAfterApproval.current = true;
                    } else if (!revisionAutoPublishArmed) {
                      publishAfterApproval.current = true;
                    } else {
                      publishedViaArming = true;
                    }
                  }
                  await mutate();
                  await revisionLogRef?.current?.mutateLog();
                  if (publishedViaArming) {
                    onPublish && onPublish();
                  }
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
            </Flex>
          )}

          {/* Non-reviewers see an explicit status while the draft waits on a
              review — without it the tab shows only the status badge and the
              draft reads as stuck. */}
          {/* Suppressed when the admin-bypass publish section renders below —
              "waiting for a reviewer" next to a working Publish button reads
              as a contradiction. */}
          {state.waitingForReview && !canReview && !showPublishSection && (
            <Callout status="info" size="sm">
              Waiting for a reviewer.{" "}
              {createdBy?.id === user?.id
                ? "Authors can't approve their own drafts. "
                : ""}
              Anyone with review permission on this feature can approve it.
              {state.canRecallReview
                ? " You can also return the draft to editing, which withdraws the review request."
                : ""}
            </Callout>
          )}

          {(() => {
            const continueLabel = "Continue to Publish →";

            // A pending schedule must be canceled before a manual publish (one
            // explicit path back to "approved"). An admin bypass override lets an
            // admin publish now over someone else's pending schedule — but not
            // over a schedule that was itself admin-armed (that reads as the
            // intentional deferral, so it still blocks publish-now).
            const scheduleBlocksPublish =
              scheduledPending && (!adminPublish || scheduleArmedByAdmin);
            const publishEnabled =
              state.submitAction === "publish" &&
              state.ctaEnabled &&
              canDoPrimary &&
              !scheduleBlocksPublish;

            const continueEnabled =
              continueToPublish &&
              state.ctaEnabled &&
              canDoPrimary &&
              !scheduleBlocksPublish;

            const primaryFooterEnabled = continueToPublish
              ? continueEnabled
              : publishEnabled;

            const primaryFooterLabel = continueToPublish
              ? continueLabel
              : scheduleBlocksPublish
                ? "Publish scheduled"
                : onlyScheduledSelected
                  ? "Schedule to Start"
                  : "Publish";

            {
              /* Unified auto-publish arming: one checkbox + a mode selector
                 ("when approved" vs "on a specific date" are mutually exclusive),
                 rendered just above the primary CTA so it reads as related. */
            }
            const autoPublishArming = showAutoPublishEditable ? (
              // Extra bottom margin separates the schedule widget from the admin
              // bypass checkbox + Publish CTA group that follows.
              <Box mb="5">
                <Flex align="center" gap="1">
                  <Checkbox
                    label="Automatically publish"
                    weight="regular"
                    disabled={savingSchedule}
                    value={autoPublishArmed}
                    setValue={(val) => doSetAutoPublishArmed(!!val)}
                  />
                  {canArmWhenApproved ? (
                    <SelectField
                      containerClassName="select-dropdown-underline mb-0"
                      value={effectivePublishMode}
                      disabled={savingSchedule}
                      isSearchable={false}
                      sort={false}
                      containerStyles={{
                        control: (s) => ({ ...s, fontSize: 14 }),
                        singleValue: (s) => ({ ...s, fontSize: 14 }),
                      }}
                      options={[
                        {
                          label: "when approved",
                          value: "approve",
                        },
                        {
                          label: "on a specific date",
                          value: "date",
                        },
                      ]}
                      onChange={(v) =>
                        doSetPublishMode(v as "approve" | "date")
                      }
                    />
                  ) : (
                    // Approved revisions can only defer to a date — "when
                    // approved" would just publish now, so show it as text.
                    <Text size="medium">on a specific date</Text>
                  )}
                </Flex>
                {autoPublishArmed && effectivePublishMode === "date" && (
                  <Box mt="2" ml="4">
                    {hasScheduledRevisions ? (
                      <>
                        <DatePicker
                          date={scheduleDate || undefined}
                          setDate={(d) =>
                            onScheduleDateChange(d ? d.toISOString() : "")
                          }
                          precision="datetime"
                          disableBefore={new Date().toISOString()}
                        />
                        <Flex align="center" gap="1" mt="2">
                          <Checkbox
                            label="Lock edits to"
                            weight="regular"
                            value={scheduleLockEnabled}
                            setValue={(v) => onScheduleLockToggle(!!v)}
                          />
                          <SelectField
                            containerClassName="select-dropdown-underline mb-0"
                            value={scheduleLockScope}
                            disabled={savingSchedule}
                            isSearchable={false}
                            sort={false}
                            containerStyles={{
                              control: (s) => ({ ...s, fontSize: 14 }),
                              singleValue: (s) => ({ ...s, fontSize: 14 }),
                            }}
                            options={[
                              { label: "this feature", value: "feature" },
                              { label: "this draft", value: "draft" },
                            ]}
                            onChange={(v) =>
                              onScheduleLockScopeChange(
                                v as "draft" | "feature",
                              )
                            }
                          />
                        </Flex>
                        {canBypassScheduleApproval && (
                          <Box mt="2">
                            <Checkbox
                              label={
                                <span style={{ color: "var(--red-11)" }}>
                                  Admin: allow scheduled publish to bypass
                                  checks
                                </span>
                              }
                              weight="regular"
                              value={scheduleBypassApproval}
                              setValue={(v) => onScheduleBypassChange(!!v)}
                            />
                          </Box>
                        )}
                        {experiments.length > 0 && (
                          <Callout status="warning" mt="2">
                            This draft would start{" "}
                            {experiments.length === 1
                              ? "a linked draft experiment"
                              : `${experiments.length} linked draft experiments`}
                            . A scheduled publish won&apos;t start{" "}
                            {experiments.length === 1 ? "it" : "them"} — it will
                            be held at the scheduled time until{" "}
                            {experiments.length === 1 ? "it is" : "they are"}{" "}
                            started (or removed from this draft). Start{" "}
                            {experiments.length === 1 ? "it" : "them"} before
                            the scheduled time to avoid a stuck publish.
                          </Callout>
                        )}
                      </>
                    ) : (
                      <PremiumTooltip commercialFeature="scheduled-revisions">
                        <Text size="small" as="div">
                          Upgrade to publish on a specific date.
                        </Text>
                      </PremiumTooltip>
                    )}
                    {scheduleError && (
                      <Callout status="error" mt="2">
                        {scheduleError}
                      </Callout>
                    )}
                    {/* Unchecking "Automatically publish" cancels the schedule;
                      the read-only card below carries Cancel + Change. */}
                  </Box>
                )}
              </Box>
            ) : showManagerScheduleReadonly && revision ? (
              // Armed + not editing: owners see the read-only card with Cancel
              // and Change (guards against accidental edits).
              renderScheduleCard({
                onChange: () => setEditingSchedule(true),
                onCancel: () => doSetAutoPublishArmed(false),
              })
            ) : showAutoPublishReadonly && revision && scheduledPending ? (
              // Read-only card: viewers without publish authority see no controls;
              // an admin-armed schedule offers Cancel (to publishers) but never an
              // inline Change — it must be canceled and re-armed.
              renderScheduleCard(
                scheduleArmedByAdmin
                  ? {
                      onCancel: canCancelAdminSchedule
                        ? () => doSetAutoPublishArmed(false)
                        : undefined,
                      note: "Armed by an admin (approval bypassed). Cancel and re-arm to change it.",
                    }
                  : {},
              )
            ) : null;

            return (
              <>
                {/* Step CTA: Request Review / Submit Review / Next. The arming
                  control renders here for drafts (no publish section yet). */}
                {isStepAction && (
                  <Box mt="4">
                    {!showPublishSection && autoPublishArming}
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
                  primary publish button. Hidden for not-yet-approved drafts
                  unless an admin can bypass — then Request Review stands alone. */}
                {showPublishSection && (
                  <Box
                    mt="4"
                    pt="4"
                    style={{ borderTop: "1px solid var(--gray-a5)" }}
                  >
                    {/* Divergence/rebase notice renders above the publish button
                    so users consider rebasing before reaching for Publish. */}
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
                        onResolveConflicts={() => setResolveConflicts(true)}
                        approvedAt={approvedAt}
                        revisionsSinceApproval={revisionsSinceApproval}
                      />
                    )}

                    {/* Arming control sits below the separator so it reads as
                    related to the Publish button. */}
                    {autoPublishArming}

                    {/* Merge conflicts are never admin-overridable — hide the
                    bypass checkbox entirely while one exists. */}
                    {canAdminPublish &&
                      mergeResult.success &&
                      (blockInfo?.overridable || adminPublish) && (
                        <Box mb="3">
                          <Checkbox
                            label={
                              <span style={{ color: "var(--red-11)" }}>
                                Admin: bypass checks and publish now
                              </span>
                            }
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

                    {/* A live schedule blocks "publish now"; the scheduled
                    status card above already explains this and offers
                    Cancel/Change, so we hide the otherwise-dead disabled
                    button. It reappears the moment the block clears (e.g. admin
                    bypass toggled, or the experiments "continue" flow). */}
                    {!(scheduleBlocksPublish && !continueToPublish) && (
                      <Button
                        onClick={primaryFooterEnabled ? doSubmit : undefined}
                        loading={
                          submitting &&
                          (state.submitAction === "publish" ||
                            continueToPublish)
                        }
                        disabled={!primaryFooterEnabled}
                        icon={state.ctaLocked ? <PiLockSimple /> : undefined}
                        style={{ width: "100%" }}
                      >
                        {primaryFooterLabel}
                      </Button>
                    )}

                    {/* ── Uniform status displays for the publish state ──
                    All callouts use the same size, spacing, and chrome so
                    the column doesn't read as a pile of differently-styled
                    messages. Stacked in priority order: ramps, errors, and
                    finally the "no approval necessary" note. */}
                    <Flex direction="column" gap="2" mt="3">
                      {linkedRamps.map((ramp) => (
                        <Callout key={ramp.id} status="info" size="sm">
                          Publishing this draft will activate ramp schedule{" "}
                          <strong>{ramp.name}</strong>. The ramp will begin once
                          this revision is live.
                        </Callout>
                      ))}

                      {!hasChanges && (
                        <Callout status="info" size="sm">
                          No changes to publish. Discard the draft or add
                          changes first.
                        </Callout>
                      )}

                      {featureLockedBySchedule && !adminPublish && (
                        <Callout status="warning" size="sm">
                          Another draft
                          {lockingScheduledSibling?.version
                            ? ` (revision ${lockingScheduledSibling.version})`
                            : ""}{" "}
                          is scheduled to publish and has locked publishing of
                          other drafts. Cancel that schedule to publish this
                          revision.
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
                )}

                {/* Errors render outside the publish section so request-review
                  failures stay visible even when that section is hidden. */}
                {(submitError || secondaryError) && (
                  <Flex direction="column" gap="2" mt="3">
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
                  </Flex>
                )}
              </>
            );
          })()}
        </Box>
      </Box>
    </Box>
  );

  return pageWrapper(
    <>
      {conflictModal}
      {discardConfirmModal}
      {/* The experiments checklist step temporarily replaces the left column;
          ReviewHeader hides the sub-tabs (hideSubTabs) so the step reads as a
          focused flow. */}
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
