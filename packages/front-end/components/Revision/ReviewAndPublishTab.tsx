import { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { format } from "date-fns";
import {
  Revision,
  checkMergeConflicts,
  applyTopLevelPatchOps,
  isUserBlockedFromApproving,
  isAutopublishOnApprovalEnabled,
} from "shared/enterprise";
import { BsThreeDotsVertical } from "react-icons/bs";
import { PiCaretDownBold, PiGitDiff, PiPencilSimpleFill } from "react-icons/pi";
import { useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";
import useURLHash from "@/hooks/useURLHash";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import Heading from "@/ui/Heading";
import Badge from "@/ui/Badge";
import Callout from "@/ui/Callout";
import Checkbox from "@/ui/Checkbox";
import HelperText from "@/ui/HelperText";
import { Tabs, TabsList, TabsTrigger } from "@/ui/Tabs";
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
} from "@/ui/DropdownMenu";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import EventUser from "@/components/Avatar/EventUser";
import Markdown from "@/components/Markdown/Markdown";
import CommentComposer from "@/components/Comments/CommentComposer";
import ReviewCommentPopover from "@/components/Reviews/ReviewCommentPopover";
import {
  PersonRow,
  ReviewerVerdictIcon,
} from "@/components/Reviews/ReviewPeople";
import {
  revisionStatusBadgeVariant,
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
import { useRevisionDiff, RevisionDiffConfig } from "./useRevisionDiff";
import { RevisionDiff } from "./RevisionDiff";
import RevisionTimeline from "./RevisionTimeline";
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

export interface ReviewAndPublishTabProps<T> {
  // The revision selected in the page header's revision dropdown. Null when
  // viewing the live state.
  revision: Revision | null;
  allRevisions: Revision[];
  // The live entity (merge target).
  currentState: T;
  diffConfig: RevisionDiffConfig<T>;
  // Per-revision approval gate (caller applies org settings + e.g. the
  // metadata-only shortcut).
  requiresApproval: boolean;
  // The viewer can edit the underlying entity (manage drafts / review).
  canEditEntity: boolean;
  // The viewer can bypass the approval requirement (admin).
  canBypassApproval: boolean;
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
// (currently saved groups). The feature-flag equivalent lives in
// components/Reviews/Feature/ReviewAndPublish.tsx on the older
// feature-revision pipeline; the two share the entity-agnostic pieces
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
  currentState,
  diffConfig,
  requiresApproval,
  canEditEntity,
  canBypassApproval,
  selectRevision,
  onPublish,
  onDiscard,
  onReopen,
  onRevert,
  onCompareRevisions,
  mutate,
}: ReviewAndPublishTabProps<T> & { revision: Revision }) {
  const { apiCall } = useAuth();
  const { users, userId, organization, hasCommercialFeature } = useUser();

  const isActiveDraft = (ACTIVE_STATUSES as readonly string[]).includes(
    revision.status,
  );
  const isAuthor = !!userId && revision.authorId === userId;
  const contributorIds = useMemo(() => {
    const ids = revision.contributors ?? [];
    return ids.includes(revision.authorId) ? ids : [revision.authorId, ...ids];
  }, [revision.contributors, revision.authorId]);
  const isContributor = !!userId && contributorIds.includes(userId);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [adminPublish, setAdminPublish] = useState(false);
  const [requestAutoPublish, setRequestAutoPublish] = useState(
    !!revision.autoPublishOnApproval,
  );
  const [showFixConflicts, setShowFixConflicts] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmReopen, setConfirmReopen] = useState(false);
  const [actionsDropdownOpen, setActionsDropdownOpen] = useState(false);

  // Reset per-revision UI state when the selection changes.
  useEffect(() => {
    setSubmitError(null);
    setAdminPublish(false);
    setRequestAutoPublish(!!revision.autoPublishOnApproval);
  }, [revision.id, revision.autoPublishOnApproval]);

  // ── Sub-tabs (mirrors the feature Review & Publish tab): `#review` reads
  // as Conversation, `#review,changes` as Changes. Diff-ref widgets in
  // comments broadcast a sub-tab request before scrolling. ──
  const [urlHash, setUrlHash] = useURLHash();
  const subTab: ReviewSubTab =
    urlHash?.split(",")[1] === "changes" ? "changes" : "overview";
  const setSubTab = useCallback(
    (t: ReviewSubTab) => {
      setUrlHash(t === "changes" ? "review,changes" : "review");
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
    );
  }, [
    isActiveDraft,
    revision.target.snapshot,
    revision.target.proposedChanges,
    currentState,
  ]);
  const mergeSuccess = !mergeResult || mergeResult.success;

  // ── Diffs: live + proposed ops for active drafts ("what publish would
  // do"); base snapshot + ops for merged/discarded ("what this revision
  // changed"). Same semantics as RevisionDetail. ──
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

  // ── Reviewers: latest verdict per user within the current review cycle.
  // Mirrors RevisionModel.addReview — "reopened" activity entries (submit
  // for review, return to draft, approval reset, reopen) start a new cycle
  // that invalidates earlier verdicts. A verdict older than the last content
  // edit is stale: still attributable, but not vouching for the current
  // draft. ──
  const reviewers = useMemo(() => {
    let cycleStart: number | null = null;
    for (const e of revision.activityLog) {
      if (e.action !== "reopened") continue;
      const t = new Date(e.dateCreated).getTime();
      if (cycleStart === null || t > cycleStart) cycleStart = t;
    }
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
      if (r.decision === "comment") continue;
      const t = new Date(r.dateCreated).getTime();
      if (cycleStart !== null && t < cycleStart) continue;
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

  const isBlockedContributor =
    !!userId &&
    hasCommercialFeature("require-approvals") &&
    isUserBlockedFromApproving({
      approvalFlows: organization?.settings?.approvalFlows,
      entityType: revision.target.type,
      revision,
      userId,
    });

  const autopublishOnApproval =
    isAutopublishOnApprovalEnabled(
      organization?.settings?.approvalFlows,
      revision.target.type,
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
        body: JSON.stringify({
          autoPublishOnApproval: requestAutoPublish,
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
  // are neutralized: no experiments, ramps, or rebase governance here —
  // conflicts gate publishing via `mergeSuccess`. ──
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
    checklistBlocked: false,
    governanceCanPublish: true,
  });

  const doSubmit = async () => {
    if (state.submitAction === "request-review") return doRequestReview();
    if (state.submitAction === "publish") return doPublish();
  };

  // ── Shared layout pieces ──
  const statusForBadge = toBadgeStatus(revision.status);
  const statusColor = revisionStatusColor(statusForBadge);
  const headerTitle =
    revision.title?.trim() ||
    revision.comment?.trim() ||
    `Revision ${revision.version ?? ""}`.trim();

  const header = (
    <Box mb="6" pt="4">
      <Heading as="h3" size="large" mb="2">
        {headerTitle}
      </Heading>
      <Flex align="center" gap="2">
        <Box style={{ flexShrink: 0 }}>
          <Badge
            size="lg"
            variant={revisionStatusBadgeVariant(statusForBadge)}
            radius="full"
            color={statusColor}
            label={revisionStatusLabel(revision.status)}
          />
        </Box>
        <Text as="span" color="text-low">
          {revision.status === "merged" ? (
            <>
              Revision <strong>{revision.version}</strong> was published
              {revision.resolution?.dateCreated
                ? ` on ${format(
                    new Date(revision.resolution.dateCreated),
                    "MMM d, yyyy",
                  )}`
                : ""}
            </>
          ) : revision.status === "discarded" ? (
            <>
              Revision <strong>{revision.version}</strong> was discarded and
              never published
            </>
          ) : (
            <>
              Merging revision <strong>{revision.version}</strong> into the live
              version
            </>
          )}
        </Text>
      </Flex>
    </Box>
  );

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

  const leftColumn = (
    <>
      {subTab === "overview" && (
        <RevisionDescriptionSection
          revision={revision}
          canEdit={isActiveDraft && canEditEntity}
          mutate={mutate}
        />
      )}

      <Box className="appbox" p="4" mb="4">
        <RevisionDiff
          diffs={diffs}
          badges={badges}
          customRenderGroups={customRenderGroups}
          variant={subTab === "overview" ? "formatted" : "json"}
          diffComments={subTab === "changes" ? diffComments : undefined}
        />
      </Box>

      <Box mb="4">
        <RevisionTimeline<T>
          revision={revision}
          collapseEdits={subTab === "overview"}
          diffConfig={diffConfig}
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

      {reviewers.length > 0 && (
        <Box mb="3">
          <Text size="medium" weight="medium" color="text-high" as="div" mb="2">
            Reviewers
          </Text>
          <Flex direction="column" gap="2">
            {reviewers.map(({ id, status, timestamp, stale }) => {
              const u = users.get(id);
              const name = u?.name || "";
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
        {revisionStatusIcon(statusForBadge) && (
          <Box style={{ fontSize: 18, lineHeight: 1, display: "flex" }}>
            {revisionStatusIcon(statusForBadge)}
          </Box>
        )}
        <Heading as="h4" size="small">
          <span style={{ color: `var(--${statusColor}-11)` }}>
            {revisionStatusLabel(revision.status)}
          </span>
        </Heading>
      </Flex>

      {isActiveDraft && (state.canRecallReview || canEditEntity) && (
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
                  Return to draft
                </DropdownMenuItem>
              )}
              {canEditEntity && (
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
              )}
            </DropdownMenuGroup>
          </DropdownMenu>
        </Box>
      )}
    </Flex>
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
          {/* Read-only auto-publish indicator for reviewers */}
          {autopublishOnApproval &&
            revisionAutoPublishArmed &&
            revision.status !== "draft" && (
              <Box mb="3">
                <Checkbox
                  label="Automatically publish when approved"
                  weight="regular"
                  value={true}
                  setValue={() => {}}
                  disabled
                />
              </Box>
            )}

          {/* Submit review — reviewer action, opens the comment/decision
              popover */}
          {canReview && requiresApproval && !approved && (
            <Flex direction="column" gap="3" mb="4">
              <ReviewCommentPopover
                onSubmit={submitReviewDecision}
                allowPublishOnApprove={autopublishOnApproval}
                autoPublishArmed={revisionAutoPublishArmed}
                isBlockedContributor={!!isBlockedContributor}
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

          {/* Auto-publish toggle — set when requesting review */}
          {autopublishOnApproval &&
            requiresApproval &&
            revision.status === "draft" &&
            canEditEntity && (
              <Box mb="3">
                <Checkbox
                  label="Automatically publish when approved"
                  weight="regular"
                  value={requestAutoPublish}
                  setValue={(val) => setRequestAutoPublish(!!val)}
                />
              </Box>
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
            {mergeResult && !mergeResult.success && (
              <Callout status="error" size="sm" mb="3">
                <Flex direction="column" gap="2" align="start">
                  <Text size="small">
                    This revision conflicts with changes published since it was
                    created. Resolve the conflicts before publishing.
                  </Text>
                  <Button
                    variant="outline"
                    size="xs"
                    color="red"
                    onClick={() => setShowFixConflicts(true)}
                    disabled={!canEditEntity}
                  >
                    Fix conflicts
                  </Button>
                </Flex>
              </Callout>
            )}

            {canBypassApproval &&
              requiresApproval &&
              mergeSuccess &&
              hasChanges &&
              (revision.status !== "approved" || adminPublish) && (
                <Box mb="3">
                  <Checkbox
                    label="Admin: bypass approval and publish now"
                    weight="regular"
                    value={adminPublish}
                    setValue={(val) => setAdminPublish(!!val)}
                  />
                </Box>
              )}

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
              style={{ width: "100%" }}
            >
              Publish
            </Button>

            <Flex direction="column" gap="2" mt="3">
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

      {header}
      {subTabBar}
      <Flex gap="5" align="start">
        <Box style={{ flex: 1, minWidth: 0 }}>{leftColumn}</Box>
        <Box style={{ width: 360, minWidth: 360, flexShrink: 0 }}>
          {isActiveDraft ? draftActionsColumn : readonlyActionsColumn}
        </Box>
      </Flex>
    </Box>
  );
}

// "Revision description" card (mirrors the feature tab's
// RevisionCommentSection): free-form markdown context for the revision,
// stored on the generic revision's `comment` field. Editable in place on
// active drafts via the markdown composer; read-only revisions show the
// rendered markdown only when a description exists.
function RevisionDescriptionSection({
  revision,
  canEdit,
  mutate,
}: {
  revision: Revision;
  canEdit: boolean;
  mutate: () => void | Promise<void>;
}) {
  const { apiCall } = useAuth();
  const [editing, setEditing] = useState(false);
  const description = revision.comment?.trim() || "";

  // Exit edit mode when switching revisions.
  useEffect(() => {
    setEditing(false);
  }, [revision.id]);

  if (!description && !canEdit) return null;

  return (
    <Box mb="4" className="appbox">
      <Flex
        align="center"
        gap="2"
        px="4"
        style={{ borderBottom: "1px solid var(--gray-a4)", minHeight: 40 }}
      >
        <Heading as="h5" size="small" color="text-mid" mb="0">
          Revision description
        </Heading>
        {canEdit && !editing && (
          <IconButton
            variant="ghost"
            color="violet"
            size="2"
            radius="full"
            mx="1"
            onClick={() => setEditing(true)}
            aria-label="Edit description"
          >
            <PiPencilSimpleFill />
          </IconButton>
        )}
      </Flex>
      <Box p="4">
        {editing ? (
          <CommentComposer
            cta="Save"
            placeholder="Describe this revision…"
            initialValue={description}
            autofocus
            onCancel={() => setEditing(false)}
            onSubmit={async (next) => {
              await apiCall(`/revision/${revision.id}/description`, {
                method: "PATCH",
                body: JSON.stringify({ description: next }),
              });
              setEditing(false);
              await mutate();
            }}
          />
        ) : description ? (
          <Markdown className="speech-bubble">{description}</Markdown>
        ) : (
          <Text size="medium" as="div" color="text-low" fontStyle="italic">
            No description yet.
          </Text>
        )}
      </Box>
    </Box>
  );
}
