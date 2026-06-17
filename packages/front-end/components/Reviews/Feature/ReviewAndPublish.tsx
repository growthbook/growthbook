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
  EventUserLoggedIn,
  EventUserApiKey,
} from "shared/types/events/event-types";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { FaArrowLeft } from "react-icons/fa";
import {
  PiLockSimple,
  PiGitDiff,
  PiGitMergeBold,
  PiCaretDownBold,
  PiHourglassHighFill,
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
import RevisionLabel, {
  revisionLabelText,
} from "@/components/Reviews/RevisionLabel";
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
import Tooltip from "@/ui/Tooltip";
import Heading from "@/ui/Heading";
import Avatar from "@/ui/Avatar";
import Badge from "@/ui/Badge";
import Link from "@/ui/Link";
import RevisionStatusBadge, {
  revisionStatusBadgeVariant,
  revisionStatusColor,
  revisionStatusIcon,
  revisionStatusLabel,
} from "@/components/Reviews/RevisionStatusBadge";
import Callout from "@/ui/Callout";
import Checkbox from "@/ui/Checkbox";
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
import { Tabs, TabsList, TabsTrigger } from "@/ui/Tabs";

// Sub-views of the review surface: "overview" is the conversation-first view
// (notes, human-readable changes, review activity), "changes" is the diff-first
// view (JSON diffs, full edit timeline, inline diff comments).
type ReviewSubTab = "overview" | "changes";
import DivergenceNotice from "@/components/Reviews/DivergenceNotice";
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
      {trailing && (
        <Flex flexShrink="0" align="center" style={{ alignSelf: "stretch" }}>
          {trailing}
        </Flex>
      )}
    </Flex>
  );
}

// Compact verdict indicator for the Reviewers widget: the revision-status
// icon in a soft colored circle (same visual language as the timeline's
// inline events), with a tooltip spelling out the state.
function ReviewerVerdictIcon({
  status,
  name,
  timestamp,
  stale,
}: {
  status: "approved" | "changes-requested";
  name: string;
  timestamp?: string;
  // The draft's content changed after this verdict (see the reviewers memo).
  stale?: boolean;
}) {
  const color = revisionStatusColor(status);
  const who = name || "This reviewer";
  const verdict =
    status === "approved"
      ? `${who} approved these changes`
      : `${who} requested changes`;
  const when = timestamp
    ? ` on ${format(new Date(timestamp), "MMM d, yyyy")}`
    : "";
  const staleNote = stale ? " — the draft has changed since" : "";
  const content = `${verdict}${when}${staleNote}`;
  return (
    <Tooltip content={content}>
      <Box style={{ position: "relative", display: "inline-flex" }}>
        {/* Stale verdicts mute to the soft variant with an hourglass pip —
            still attributable, but visibly not vouching for the current
            draft content. */}
        <Avatar size="sm" color={color} variant={stale ? "soft" : "solid"}>
          <>{revisionStatusIcon(status)}</>
        </Avatar>
        {stale && (
          <Flex
            align="center"
            justify="center"
            style={{
              position: "absolute",
              right: -5,
              bottom: -4,
              color: "var(--gray-10)",
              fontSize: 13,
              // Halo separates the glyph from the chip without boxing it in.
              filter:
                "drop-shadow(0 0 1.5px var(--color-panel-solid)) drop-shadow(0 0 1.5px var(--color-panel-solid))",
            }}
          >
            <PiHourglassHighFill />
          </Flex>
        )}
      </Box>
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
  const otherDraftsNav =
    otherAttentionDrafts.length === 1 ? (
      <Flex align="center" gap="2">
        <Text color="text-mid" whiteSpace="nowrap">
          1 other draft needs attention:
        </Text>
        <Link
          weight="medium"
          onClick={() => setVersion(otherAttentionDrafts[0].version)}
        >
          {revisionLabelText(
            otherAttentionDrafts[0].version,
            otherAttentionDrafts[0].title,
            false,
          )}
        </Link>
        <RevisionStatusBadge
          revision={otherAttentionDrafts[0]}
          liveVersion={feature.version}
        />
      </Flex>
    ) : otherAttentionDrafts.length > 1 ? (
      <DropdownMenu
        trigger={
          <Link weight="medium">
            {otherAttentionDrafts.length} other drafts need attention{" "}
            <PiCaretDownBold size={11} />
          </Link>
        }
        menuPlacement="end"
      >
        {otherAttentionDrafts.map((r) => (
          <DropdownMenuItem
            key={r.version}
            onClick={() => setVersion(r.version)}
          >
            <Flex align="center" justify="between" gap="4" width="100%">
              <RevisionLabel version={r.version} title={r.title} />
              <RevisionStatusBadge revision={r} liveVersion={feature.version} />
            </Flex>
          </DropdownMenuItem>
        ))}
      </DropdownMenu>
    ) : null;

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
  const [requestAutoPublish, setRequestAutoPublish] = useState(
    !!revision?.autoPublishOnApproval,
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

  // The revision loads asynchronously, so the initial useState above can be
  // stale (e.g. unchecked on reload of an armed draft). Re-sync whenever the
  // persisted value or version changes. Keyed on the persisted boolean (not
  // object identity) so it won't clobber an unsaved draft toggle, which doesn't
  // change revision.autoPublishOnApproval.
  useEffect(() => {
    setRequestAutoPublish(!!revision?.autoPublishOnApproval);
  }, [revision?.autoPublishOnApproval, revision?.version]);

  // ── Sub-tabs ──
  // "Overview" (human-readable changes + review activity) vs "Changes" (JSON
  // diffs + full timeline). Reflected in the URL hash as `#review` /
  // `#review,changes` so the view is deep-linkable; a bare `#review` reads as
  // Overview.
  const [urlHash, setUrlHash] = useURLHash();
  const subTab: ReviewSubTab =
    urlHash?.split(",")[1] === "changes" ? "changes" : "overview";
  const setSubTab = useCallback(
    (t: ReviewSubTab) => {
      setUrlHash(t === "changes" ? "review,changes" : "review");
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
  const canToggleAutoPublish =
    autopublishOnApproval &&
    permissionsUtil.canPublishFeature(feature, envIds) &&
    (revision?.status === "draft" || isReviewRequester);
  const showAutoPublishReadonly =
    autopublishOnApproval && revisionAutoPublishArmed && !canToggleAutoPublish;

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
            <Button variant="soft" onClick={() => onClose()}>
              Back to Overview
            </Button>
          </Box>
        )}
      </Callout>,
    );
  }

  // ── Sub-tab bar: Overview | Changes, full-width underline (rendered above
  // the two-column layout in both the draft and read-only flows). The
  // cross-revision audit tool rides along on the right so reviewers can
  // pivot from "this draft vs live" to "any revision vs any revision".
  // Same embed pattern as the rules tab bar: the wrapping Flex carries the
  // underline so it runs beneath the right-aligned action too. ──
  const subTabBar = (
    <Box mb="4">
      <Tabs value={subTab} onValueChange={(v) => setSubTab(v as ReviewSubTab)}>
        <Flex
          align="center"
          justify="between"
          style={{ boxShadow: "inset 0 -1px 0 0 var(--slate-a3)" }}
        >
          <TabsList style={{ boxShadow: "none" }}>
            <TabsTrigger value="overview">Conversation</TabsTrigger>
            <TabsTrigger value="changes">Changes</TabsTrigger>
          </TabsList>
          {onCompareRevisions && (
            <Box pl="2" flexShrink="0">
              <Button
                variant="ghost"
                size="sm"
                icon={<PiGitDiff />}
                onClick={onCompareRevisions}
                style={{ whiteSpace: "nowrap" }}
              >
                Compare revisions
              </Button>
            </Box>
          )}
        </Flex>
      </Tabs>
    </Box>
  );

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
    const statusColor = revisionStatusColor(status);
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
      <Box mb="4">
        <Flex align="start" justify="between" gap="4">
          <Box>
            <Heading as="h3" size="medium" mb="2">
              {headerTitle}{" "}
              <span
                style={{
                  display: "inline-block",
                  verticalAlign: "middle",
                  // correct `middle` to the visual center of the glyphs
                  transform: "translateY(-2px)",
                  marginLeft: 4,
                }}
              >
                <Badge
                  variant={revisionStatusBadgeVariant(status)}
                  radius="full"
                  color={statusColor}
                  label={revisionStatusLabel(status)}
                />
              </span>
            </Heading>
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
          </Box>
          {otherDraftsNav && (
            <Box flexShrink="0" pt="1">
              {otherDraftsNav}
            </Box>
          )}
        </Flex>
      </Box>
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
        {subTabBar}
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
    featureLockedByRamp;

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
        case "request-review":
          setSubmitting(true);
          await apiCall(`/feature/${feature.id}/${revision.version}/request`, {
            method: "POST",
            body: JSON.stringify({
              mergeResultSerialized: JSON.stringify(mergeResult),
              comment,
              autoPublishOnApproval: requestAutoPublish,
            }),
          });
          // The review log drives reviewRequesterId (and thus the "Retract
          // review request" affordance) — refresh it alongside the revision.
          await Promise.all([mutate(), mutateReviewLog()]);
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
  doSubmitRef.current = doSubmit;

  const doToggleAutoPublish = async (enabled: boolean) => {
    setRequestAutoPublish(enabled);
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
        setRequestAutoPublish(!enabled);
      }
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
        useRadixButton={true}
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
  const staleBase = revision.baseVersion !== feature.version;

  const mergeHeader = (
    <Box mb="4">
      <Flex align="start" justify="between" gap="4">
        <Box>
          <Heading as="h3" size="medium" mb="2">
            {headerTitle}{" "}
            <span
              style={{
                display: "inline-block",
                verticalAlign: "middle",
                // correct `middle` to the visual center of the glyphs
                transform: "translateY(-2px)",
                marginLeft: 4,
              }}
            >
              <Badge
                variant="soft"
                radius="full"
                color={revisionStatusColor(revision.status)}
                label={revisionStatusLabel(revision.status)}
              />
            </span>
          </Heading>
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
            {staleBase ? (
              <> · based on revision {revision.baseVersion}</>
            ) : null}
          </Text>
        </Box>
        {otherDraftsNav && (
          <Box flexShrink="0" pt="1">
            {otherDraftsNav}
          </Box>
        )}
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
          {/* Read-only auto-publish indicator for reviewers */}
          {showAutoPublishReadonly && (
            <Box mb="3">
              <Checkbox
                label="Automatically publish when approved"
                weight="regular"
                value={revisionAutoPublishArmed}
                setValue={() => {}}
                disabled
              />
            </Box>
          )}

          {/* Submit review — reviewer action, opens the comment/decision popover */}
          {canReview && isPendingReview && !approved && (
            <Flex direction="column" gap="3">
              <ReviewCommentPopover
                submitUrl={`/feature/${feature.id}/${revision.version}/submit-review`}
                allowPublishOnApprove={autopublishOnApproval}
                autoPublishArmed={revisionAutoPublishArmed}
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

          {(() => {
            // Step actions that come before publish (Request Review, Submit
            // Review, Next). Not gated on conflict state — requesting a review
            // is allowed while conflicts exist; only publishing is blocked.
            const isStepAction =
              state.hasSubmit &&
              state.submitAction !== "publish" &&
              state.submitAction !== "none" &&
              // Pre-launch checklist uses the publish footer CTA instead.
              state.submitAction !== "next-experiments";

            const continueToPublish =
              state.submitAction === "next-experiments" && !experimentsStep;

            const continueLabel = "Continue to Publish →";

            // What's blocking publish right now (raw, ignoring adminPublish so
            // the block is still visible while the checkbox is unchecked). The
            // button label never changes — the surrounding context (status
            // header, divergence notice, conflict callout) explains why it's
            // disabled. `overridable` gates the admin-bypass checkbox.
            type BlockInfo = { overridable: boolean } | null;
            const blockInfo: BlockInfo = (() => {
              if (!mergeResult.success) return { overridable: false };
              if (!hasChanges) return { overridable: false };
              if (!hasPublishPermission) return { overridable: false };
              if (
                requireReviews &&
                !adminPublish &&
                ["draft", "pending-review", "changes-requested"].includes(
                  revision.status,
                )
              )
                return { overridable: true };
              if (!adminPublish && !governance?.canPublish)
                return { overridable: true };
              if (!adminPublish && featureLockedByRamp)
                return { overridable: true };
              return null;
            })();

            const publishEnabled =
              state.submitAction === "publish" &&
              state.ctaEnabled &&
              canDoPrimary;

            const continueEnabled =
              continueToPublish && state.ctaEnabled && canDoPrimary;

            const primaryFooterEnabled = continueToPublish
              ? continueEnabled
              : publishEnabled;

            const primaryFooterLabel = continueToPublish
              ? continueLabel
              : onlyScheduledSelected
                ? "Schedule to Start"
                : "Publish";

            // Hide the publish section (divider, admin-bypass checkbox, Publish
            // button) for not-yet-approved drafts — unless an admin can bypass
            // checks. There, Request Review is the only relevant action.
            const adminCanBypassNow =
              canAdminPublish &&
              mergeResult.success &&
              (blockInfo?.overridable || adminPublish);
            const showPublishSection =
              state.submitAction === "publish" ||
              continueToPublish ||
              adminCanBypassNow;

            return (
              <>
                {/* Auto-publish toggle (editable by requestor) */}
                {canToggleAutoPublish && (
                  <Box mb="3">
                    <Checkbox
                      label="Automatically publish when approved"
                      weight="regular"
                      value={requestAutoPublish}
                      setValue={(val) => doToggleAutoPublish(!!val)}
                    />
                  </Box>
                )}

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

                    {/* Merge conflicts are never admin-overridable — hide the
                    bypass checkbox entirely while one exists. */}
                    {canAdminPublish &&
                      mergeResult.success &&
                      (blockInfo?.overridable || adminPublish) && (
                        <Box mb="3">
                          <Checkbox
                            label="Admin: bypass checks and publish now"
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
                      onClick={primaryFooterEnabled ? doSubmit : undefined}
                      loading={
                        submitting &&
                        (state.submitAction === "publish" || continueToPublish)
                      }
                      disabled={!primaryFooterEnabled}
                      icon={state.ctaLocked ? <PiLockSimple /> : undefined}
                      style={{ width: "100%" }}
                    >
                      {primaryFooterLabel}
                    </Button>

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
      {mergeHeader}
      {/* The experiments checklist step temporarily replaces the left column;
          hide the sub-tabs so the step reads as a focused flow. */}
      {!experimentsStep && subTabBar}
      <Flex gap="5" align="start">
        <Box style={{ flex: 1, minWidth: 0 }}>{changesColumn}</Box>
        <Box style={{ width: 360, minWidth: 360, flexShrink: 0 }}>
          {actionsColumn}
        </Box>
      </Flex>
    </>,
  );
}
