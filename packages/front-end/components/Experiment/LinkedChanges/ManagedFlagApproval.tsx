import { useMemo, useState } from "react";
import { getLatestPhaseVariations } from "shared/experiments";
import { datetime } from "shared/dates";
import { ANY_REVIEW_FOOTPRINT } from "shared/util";
import { Box, Flex, Separator, IconButton } from "@radix-ui/themes";
import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import {
  FeatureRevisionInterface,
  RevisionLog,
} from "shared/types/feature-revision";
import { BsThreeDotsVertical } from "react-icons/bs";
import { getReviewAndPublishState } from "@/components/Reviews/reviewAndPublishState";
import {
  PersonRow,
  ReviewerVerdictIcon,
} from "@/components/Reviews/ReviewPeople";
import { revisionStatusLabel } from "@/components/Reviews/RevisionStatusBadge";
import ApprovalStatusBand from "@/components/Reviews/ApprovalStatusBand";
import { getVariationValueChanges } from "@/components/Experiment/LinkedChanges/linkedFeatureDiff";
import {
  EnvironmentStateChips,
  getEnvironmentStates,
} from "@/components/Experiment/LinkedChanges/EnvironmentStatesGrid";
import {
  findActiveVerdict,
  rowVisual,
  scanVerdictRetractions,
} from "@/components/Reviews/RevisionTimeline";
import MarkdownWithDiffRefs from "@/components/Reviews/DiffCommentMarkdown";
import CommentCard from "@/components/Comments/CommentCard";
import Avatar from "@/ui/Avatar";
import Badge from "@/ui/Badge";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import HelperText from "@/ui/HelperText";
import Link from "@/ui/Link";
import Callout from "@/ui/Callout";
import Checkbox from "@/ui/Checkbox";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Field from "@/components/Forms/Field";
import RadioGroup from "@/ui/RadioGroup";
import VariationLabel from "@/ui/VariationLabel";
import ValueDisplay from "@/components/Features/ValueDisplay";
import { formatValue } from "@/components/Features/FeatureDiffRenders";
import { TextChangedField } from "@/components/AuditHistoryExplorer/DiffRenderUtils";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { getEnabledEnvironments, useEnvironments } from "@/services/features";
import useApi from "@/hooks/useApi";

type ReviewDecision = "Comment" | "Requested Changes" | "Approved";

const logUserId = (l: RevisionLog) =>
  l.user && "id" in l.user ? (l.user as { id: string }).id : null;

type Props = {
  experiment: ExperimentInterfaceStringDates;
  info: LinkedFeatureInfo;
  mutate: () => void;
  /** Overrides the trigger label when the surrounding copy already sets it up. */
  ctaLabel?: string;
  /** "inherit" lets the trigger take its surroundings' accent (e.g. a Callout). */
  triggerColor?: "inherit";
};

// CTA + reviewers only: a managed flag has one rule and one draft, so the
// Review & Publish tab's deferral and diff machinery has nothing to act on.
export default function ManagedFlagApproval({
  experiment,
  info,
  mutate,
  ctaLabel,
  triggerColor,
}: Props) {
  const { apiCall } = useAuth();
  const { userId, users } = useUser();
  const permissionsUtil = usePermissionsUtil();
  const allEnvironments = useEnvironments();
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState("");
  const [decision, setDecision] = useState<ReviewDecision>("Comment");
  const [adminBypass, setAdminBypass] = useState(false);
  const [editingLogId, setEditingLogId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const version = info.pendingDraft?.version;
  // Not gated on `open`: the trigger's label depends on who authored the draft.
  const { data, mutate: mutateRevisions } = useApi<{
    revisions: FeatureRevisionInterface[];
  }>(`/feature/${info.feature.id}`, {
    shouldRun: () => (version ?? null) !== null,
  });
  const revision = useMemo(
    () => data?.revisions?.find((r) => r.version === version),
    [data, version],
  );

  const status = info.pendingDraft?.status ?? "draft";
  const approval = info.pendingDraft?.approval;
  // Approved on paper, blocked in practice — an uncovered environment or a
  // required team that has not signed.
  const approvalGated =
    !!approval && !approval.satisfied && status === "approved";
  // A revision keeps the status it was left in, so a draft opened while
  // approvals were on stays "pending-review" after the org turns them off.
  const requireReviews = !!info.pendingDraft?.pendingApproval;
  const reviews = revision?.reviews ?? [];
  const isReviewer = reviews.some((r) => r.userId === userId);

  // Starting the experiment is the publish, so a draft runs review only.
  const publishIsLaunch = experiment.status === "draft";
  // Publishing unapproved is an explicit act, not a standing privilege: the
  // admin opts in per publish, the same way the feature's own panel asks.
  const adminBypassAvailable =
    !publishIsLaunch &&
    requireReviews &&
    !(approval?.satisfied ?? status === "approved") &&
    !info.pendingDraft?.hasMergeConflict &&
    (info.pendingDraft?.hasChanges ?? true) &&
    permissionsUtil.canBypassFlagApprovalChecks(info.feature, "feature");

  const stateInput = {
    requireReviews,
    status,
    // Conflicts are surfaced by the card's callouts; never offer a failing CTA.
    mergeSuccess: !info.pendingDraft?.hasMergeConflict,
    // The publish gate's own test, so the CTA can't offer a no-op publish.
    hasChanges: info.pendingDraft?.hasChanges ?? true,
    hasReviewPermission: permissionsUtil.canReviewFeatureDrafts(
      info.feature,
      ANY_REVIEW_FOOTPRINT,
    ),
    canManageDraft: permissionsUtil.canEditFeatureDrafts(info.feature),
    isReviewRequester: revision?.createdBy?.id === userId,
    isContributor: (revision?.contributors ?? []).includes(userId ?? ""),
    isDraftOwner: revision?.createdBy?.id === userId,
    isReviewer,
    // The experiment's own start runs the pre-launch checklist.
    hasSelectedExperiments: false,
    onlyScheduledSelected: false,
    experimentsStep: false,
    featureLockedByRamp: false,
    featureLockedBySchedule: false,
    checklistIncomplete: false,
    checklistBlocked: false,
    checklistAcknowledged: true,
    governanceCanPublish: true,
    editsResetStatus: true,
  };
  // Two reads of the same machine: the bypass changes the CTA, but the blocker
  // banners keep describing what is being skipped.
  const baseState = getReviewAndPublishState({
    ...stateInput,
    adminPublish: false,
  });
  const adminOverride = adminBypassAvailable && adminBypass;
  const state = adminOverride
    ? getReviewAndPublishState({ ...stateInput, adminPublish: true })
    : baseState;

  // "any": the precise footprint needs the live and base revisions, which this
  // modal does not load (the full Review & Publish tab falls back the same way
  // without them). The server recomputes it exactly and refuses if it does not
  // hold, so the cost of being generous here is a 403, not a bad write.
  const canReview =
    requireReviews &&
    permissionsUtil.canReviewFeatureDrafts(
      info.feature,
      ANY_REVIEW_FOOTPRINT,
    ) &&
    status === "pending-review" &&
    !!revision &&
    revision.createdBy?.id !== userId;

  // `getReviewAndPublishState` deliberately carries no authority — the full
  // Review & Publish tab gates its CTA separately, and so must this one, or a
  // viewer without rights gets an enabled button that 403s.
  const canPublish = permissionsUtil.canPublishFeature(
    info.feature,
    getEnabledEnvironments(info.feature, allEnvironments),
  );
  const canManage = permissionsUtil.canEditFeatureDrafts(info.feature);

  // Starting the experiment is the publish, so only publish is launch-gated.
  // Request-review has to stay reachable: a draft can land back in `draft` or
  // `changes-requested` after the auto-request, and without this CTA that state
  // has no action at all.
  const submitAction =
    state.submitAction === "publish" && publishIsLaunch
      ? "none"
      : state.submitAction;
  const submitAuthorized =
    submitAction === "publish"
      ? canPublish
      : submitAction === "request-review"
        ? canManage
        : true;
  const showSubmit =
    state.hasSubmit && submitAction !== "none" && submitAuthorized;

  async function runAction(
    path: string,
    body: Record<string, unknown> = {},
    method: "POST" | "PUT" = "POST",
  ) {
    await apiCall(`/experiment/${experiment.id}/managed-flag/${path}`, {
      method,
      body: JSON.stringify(body),
    });
    setComment("");
    // The parent mutate only refreshes /experiment/:id; this modal's own
    // fetches need revalidating or it keeps its pre-action revision.
    await Promise.all([mutate(), mutateRevisions(), mutateLog()]);
  }

  // Editing a comment or retracting a review happens inside the conversation,
  // so those stay in the body and surface their own errors. The footer CTA runs
  // `runAction` directly and lets Modal own its loading, error and close.
  async function post(
    path: string,
    body: Record<string, unknown> = {},
    method: "POST" | "PUT" = "POST",
  ) {
    setSubmitting(true);
    setError(null);
    try {
      await runAction(path, body, method);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  const primaryAction = canReview
    ? {
        label: "Submit review",
        enabled: comment.trim().length > 0 || decision !== "Comment",
        run: () => runAction("submit-review", { comment, review: decision }),
      }
    : showSubmit
      ? {
          label: state.ctaLabel,
          enabled: state.ctaEnabled,
          run: () =>
            runAction(
              submitAction === "publish" ? "publish" : "request-review",
              submitAction === "publish" ? {} : { comment },
            ),
        }
      : null;

  // The author leads, then anyone who contributed to the draft — the same
  // list the Review & Publish tab shows.
  const contributorIds = (() => {
    const authorId = revision?.createdBy?.id;
    const ids = revision?.contributors ?? [];
    if (!authorId) return ids;
    return ids.includes(authorId) ? ids : [authorId, ...ids];
  })();

  const contributorRows = contributorIds.map((id) => {
    const user = users.get(id);
    return (
      <PersonRow
        key={id}
        id={id}
        name={user?.name ?? ""}
        email={user?.email ?? ""}
      />
    );
  });

  // An approval can stand and still not sanction the publish; the icon says so.
  const insufficientReasons = useMemo(
    () =>
      new Map(
        (approval?.insufficientApprovers ?? []).map((a) => [a.id, a.reason]),
      ),
    [approval],
  );

  const reviewerRows = reviews.map((r) => {
    const user = users.get(r.userId);
    const name = user?.name ?? "";
    const email = user?.email ?? "";
    // "-stale" verdicts still count as this reviewer's position, but the icon
    // mutes to show the draft moved on since they gave it.
    const stale = r.status.endsWith("-stale");
    const verdict = stale
      ? (r.status.replace("-stale", "") as "approved" | "changes-requested")
      : (r.status as "approved" | "changes-requested");
    return (
      <PersonRow
        key={r.userId}
        id={r.userId}
        name={name}
        email={email}
        trailing={
          <ReviewerVerdictIcon
            status={verdict}
            name={name || email}
            timestamp={String(r.timestamp)}
            stale={stale}
            uncoveredReason={insufficientReasons.get(r.userId)}
          />
        }
      />
    );
  });

  // Verdicts carry the reviewer's comment in the revision log, not on the
  // verdict itself, so the conversation needs its own fetch.
  const { data: logData, mutate: mutateLog } = useApi<{ log: RevisionLog[] }>(
    `/feature/${info.feature.id}/${version}/log`,
    { shouldRun: () => open && (version ?? null) !== null },
  );
  // Comments and verdicts. A retracted verdict stays in the thread with a
  // badge, the way the feature timeline shows it — dropping it made a review
  // vanish and reappear on re-approval.
  const sortedLog = useMemo(
    () =>
      [...(logData?.log ?? [])].sort((a, b) =>
        String(a.timestamp).localeCompare(String(b.timestamp)),
      ),
    [logData],
  );
  const retractions = useMemo(
    () => scanVerdictRetractions(sortedLog, userId),
    [sortedLog, userId],
  );
  // `undo-review` always acts on the standing verdict, so only that row may
  // offer to retract — otherwise retracting from an older row silently pulls
  // back the newer one.
  const activeVerdict = useMemo(
    () => findActiveVerdict(sortedLog, userId, retractions),
    [sortedLog, userId, retractions],
  );
  const conversationActions = [
    "Comment",
    "Review Requested",
    "Approved",
    "Requested Changes",
  ];
  const reviewComments = sortedLog
    .filter((l) => conversationActions.includes(l.action))
    .map((l) => {
      let comment: string | undefined;
      try {
        comment = JSON.parse(l.value)?.comment;
      } catch {
        // not JSON
      }
      return {
        ...l,
        comment,
        retraction: retractions.get(l) ?? null,
        isActiveVerdict: l === activeVerdict,
      };
    });

  const variations = getLatestPhaseVariations(experiment);
  // The same readout the overview shows, from where the draft would run.
  const environmentStates = getEnvironmentStates(info.pendingDraft ?? {}, {
    future: publishIsLaunch ? "started" : "published",
  });

  // Only a value that moved earns the before/after treatment; a first draft has
  // no live rule to compare against, and an unchanged one reads as "Δ x → x".
  const valueChanges = getVariationValueChanges(
    info,
    variations.map((v) => v.id),
  );
  const variationValues = variations.map((v, i) => ({
    v,
    i,
    ...valueChanges[i],
  }));
  const hasValueChanges = variationValues.some((r) => r.changed);

  const changesColumn = (
    <Flex
      direction="column"
      gap="3"
      width={requireReviews ? "50%" : "100%"}
      minWidth="0"
    >
      <Text size="lg" weight="semibold" color="text-high">
        Changes
      </Text>
      {variationValues.map(({ v, i, before, after, changed }) => (
        <Box key={v.id}>
          <VariationLabel number={i} name={v.name} size="sm" />
          <Box mt="1">
            {changed ? (
              <TextChangedField
                pre={formatValue(before)}
                post={formatValue(after)}
              />
            ) : (
              <ValueDisplay
                value={after}
                type={info.feature.valueType}
                sparse={info.pendingDraft?.sparse ?? info.sparse}
                defaultValue={info.feature.defaultValue}
                showCopyButton={false}
                fullStyle={{ maxHeight: 60, overflowY: "auto" }}
              />
            )}
          </Box>
        </Box>
      ))}
      {environmentStates.length > 0 && (
        <Box>
          <Text as="div" size="md" weight="semibold" color="text-high" mb="2">
            Environments
          </Text>
          <EnvironmentStateChips states={environmentStates} />
        </Box>
      )}
    </Flex>
  );

  // Approval is the first gate, so say so — otherwise the notice reads as
  // though starting the experiment is all that stands in the way.
  const awaitingApproval =
    requireReviews && !(approval?.satisfied ?? status === "approved");
  // Approved-but-gated needs its own wording: "once approved" reads as a
  // contradiction next to an "Approved" label.
  const unblocks = approvalGated
    ? "Once the requirements above are met"
    : "Once approved";
  const publishNotice = publishIsLaunch
    ? awaitingApproval
      ? `${unblocks}, publishes when you start the experiment.`
      : "Publishes when you start the experiment."
    : awaitingApproval
      ? `${unblocks}, you can publish to make these values live.`
      : "Publish to make these values live.";

  const reviewColumn = (
    <Flex direction="column" gap="3" width="50%" minWidth="0">
      {contributorRows.length > 0 && (
        <Box>
          <Flex align="center" justify="between" gap="2" mb="2">
            <Text size="lg" weight="medium" color="text-high" as="div">
              Contributors
            </Text>
            {state.canRecallReview && (
              <DropdownMenu
                trigger={
                  <IconButton
                    variant="ghost"
                    color="gray"
                    radius="full"
                    size="2"
                    highContrast
                    aria-label="Review actions"
                  >
                    <BsThreeDotsVertical size={16} />
                  </IconButton>
                }
                menuPlacement="end"
                variant="soft"
              >
                <DropdownMenuItem
                  disabled={submitting}
                  onClick={() => post("recall-review")}
                >
                  Return to draft
                </DropdownMenuItem>
              </DropdownMenu>
            )}
          </Flex>
          <Flex direction="column" gap="2">
            {contributorRows}
          </Flex>
        </Box>
      )}

      {reviewerRows.length > 0 && (
        <Box>
          <Text size="lg" weight="medium" color="text-high" as="div" mb="2">
            Reviewers
          </Text>
          <Flex direction="column" gap="2">
            {reviewerRows}
          </Flex>
        </Box>
      )}

      {/* One block: the verdict and its note belong together, and the column's
          own gap would otherwise push them apart. The comment shows only when
          something will carry it — the footer CTA needs authority this viewer
          may not have. */}
      {(canReview ||
        (!!primaryAction && submitAction === "request-review")) && (
        <Flex direction="column" gap="2" mt="2">
          {canReview && (
            <RadioGroup
              gap="0"
              value={decision}
              setValue={(v) => setDecision(v as ReviewDecision)}
              options={[
                { value: "Comment", label: "Comment" },
                { value: "Requested Changes", label: "Request changes" },
                { value: "Approved", label: "Approve" },
              ]}
            />
          )}
          <Field
            size="md"
            textarea
            minRows={2}
            placeholder="Add a comment (optional)"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        </Flex>
      )}

      {error && (
        <Callout status="error" size="sm">
          {error}
        </Callout>
      )}

      {(adminOverride || !primaryAction) && baseState.waitingForReview && (
        // The same band the Review & Publish tab shows for this phase.
        <ApprovalStatusBand
          phase="waiting"
          footprint={approval?.footprint}
          unmet={approval?.unmetTeams ?? []}
          subtle
        />
      )}

      {approvalGated && (
        // Approved, but the server would still refuse: name what is missing
        // rather than letting the start fail with a bare error.
        <ApprovalStatusBand
          phase="gated"
          footprint={approval.footprint}
          unmet={approval.unmetTeams}
          coverageMessage={
            approval.unmetTeams.length === 0
              ? "The approvals on this draft do not cover every environment it changes."
              : null
          }
          subtle
        />
      )}

      {adminBypassAvailable && (
        <Box>
          <Checkbox
            label={
              <span style={{ color: "var(--red-11)" }}>
                Admin: bypass approval and publish now
              </span>
            }
            weight="regular"
            value={adminBypass}
            setValue={(val) => setAdminBypass(!!val)}
          />
        </Box>
      )}

      {reviewComments.length > 0 && (
        <>
          <Separator size="4" />
          <Flex direction="column" gap="3">
            {reviewComments.map((l, i) => {
              // The Review & Publish tab's vocabulary, so an approval, a
              // change request and a comment stay distinguishable.
              const visual = rowVisual(l.action);
              const verdictColor =
                l.action === "Approved"
                  ? "green"
                  : l.action === "Requested Changes"
                    ? "red"
                    : null;
              const isOwn = !!logUserId(l) && logUserId(l) === userId;
              return (
                <CommentCard
                  key={l.id ?? i}
                  user={l.user}
                  // Colon, not "on": this column is half a modal wide and the
                  // phrase has to hold one line.
                  metadata={`${visual.verb}: ${datetime(l.timestamp)}`}
                  metadataExtra={
                    l.retraction ? (
                      <Badge
                        color="gray"
                        variant="solid"
                        label={l.retraction.label}
                        size="xs"
                      />
                    ) : undefined
                  }
                  stripeColor={visual.color}
                  leading={
                    verdictColor ? (
                      <Avatar size="sm" color={verdictColor} variant="solid">
                        <>{visual.icon}</>
                      </Avatar>
                    ) : undefined
                  }
                  avatarSize="sm"
                  compact
                  actions={
                    isOwn && (l.id || l.isActiveVerdict) ? (
                      <DropdownMenu
                        trigger={
                          <IconButton
                            variant="ghost"
                            color="gray"
                            radius="full"
                            size="1"
                            highContrast
                          >
                            <BsThreeDotsVertical size={14} />
                          </IconButton>
                        }
                        menuPlacement="end"
                      >
                        {l.id && l.comment && (
                          <DropdownMenuItem
                            onClick={() => {
                              setEditingLogId(l.id ?? null);
                              setEditText(l.comment ?? "");
                            }}
                          >
                            Edit
                          </DropdownMenuItem>
                        )}
                        {l.isActiveVerdict && state.canUndoReview && (
                          <DropdownMenuItem
                            color="red"
                            onClick={() => post("undo-review")}
                          >
                            Retract review
                          </DropdownMenuItem>
                        )}
                      </DropdownMenu>
                    ) : undefined
                  }
                  // A bare verdict has no body — same chrome, header line only.
                  body={
                    editingLogId && editingLogId === l.id ? (
                      <Flex direction="column" gap="2">
                        <Field
                          size="sm"
                          textarea
                          minRows={2}
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                        />
                        <Flex gap="2">
                          <Button
                            size="sm"
                            disabled={submitting || !editText.trim()}
                            onClick={async () => {
                              await post(
                                `log/${l.id}`,
                                { comment: editText, version },
                                "PUT",
                              );
                              setEditingLogId(null);
                            }}
                          >
                            Save
                          </Button>
                          <Link onClick={() => setEditingLogId(null)}>
                            Cancel
                          </Link>
                        </Flex>
                      </Flex>
                    ) : l.comment ? (
                      <MarkdownWithDiffRefs className="speech-bubble">
                        {l.comment}
                      </MarkdownWithDiffRefs>
                    ) : undefined
                  }
                />
              );
            })}
          </Flex>
        </>
      )}
    </Flex>
  );

  return (
    <>
      <Button
        variant="ghost"
        color={triggerColor}
        onClick={() => setOpen(true)}
      >
        {/* Name what the modal actually offers. With no action available — the
            author can't approve their own draft — it's still worth opening to
            see the changes and who has reviewed. */}
        {canReview
          ? "Review"
          : showSubmit
            ? (ctaLabel ?? state.ctaLabel)
            : "Review changes"}
      </Button>
      <ModalStandard
        open={open}
        trackingEventModalType="managed-flag-approval"
        trackingEventModalSource="experiment-overview"
        header={hasValueChanges ? "Review Value Changes" : "Review Values"}
        hideHeader
        bodyMb="0"
        size="lg"
        close={() => setOpen(false)}
        closeCta={primaryAction ? "Cancel" : "Close"}
        // Beside the CTAs, where it reads as a note on the action rather than
        // a line of the content.
        secondaryAction={
          <HelperText status="info">
            {requireReviews
              ? `${revisionStatusLabel(status)}. ${publishNotice}`
              : publishNotice}
          </HelperText>
        }
        cta={primaryAction?.label}
        ctaEnabled={!!primaryAction?.enabled}
        submit={primaryAction ? primaryAction.run : undefined}
      >
        {requireReviews ? (
          <Flex gap="4" width="100%">
            {changesColumn}
            {/* Radix vertical separators collapse without an explicit stretch. */}
            <Separator
              orientation="vertical"
              style={{ alignSelf: "stretch", height: "auto" }}
            />
            {reviewColumn}
          </Flex>
        ) : (
          // Nothing to review, so the column would be a status line and a lot
          // of empty space; the notice sits under the changes instead.
          <Flex direction="column" width="100%">
            {changesColumn}
          </Flex>
        )}
      </ModalStandard>
    </>
  );
}
