import { useCallback, useEffect, useMemo, useState } from "react";
import { getLatestPhaseVariations } from "shared/experiments";
import { datetime } from "shared/dates";
import {
  ANY_REVIEW_FOOTPRINT,
  autoMerge,
  evaluatePublishGovernance,
  fillRevisionFromFeature,
  filterEnvironmentsByFeature,
  getReviewSetting,
  liveRevisionFromFeature,
  requireFreshBaseForPublish,
} from "shared/util";
import { Box, Flex, Separator, IconButton } from "@radix-ui/themes";
import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import {
  FeatureRevisionInterface,
  RevisionLog,
} from "shared/types/feature-revision";
import { findPublishLockingScheduledRevision } from "shared/enterprise";
import { RampScheduleInterface } from "shared/validators";
import { BsThreeDotsVertical } from "react-icons/bs";
import { PiCaretDownFill } from "react-icons/pi";
import { getReviewAndPublishState } from "@/components/Reviews/reviewAndPublishState";
import {
  featureToFeatureRevisionDiffInput,
  revisionToFeatureRevisionDiffInput,
  useFeatureRevisionDiff,
} from "@/hooks/useFeatureRevisionDiff";
import {
  FormattedChanges,
  type FormattedChangeItem,
} from "@/components/Reviews/Feature/RevisionDiffUtils";
import { renderEnvironmentToggles } from "@/components/Features/FeatureDiffRenders";
import {
  PersonRow,
  ReviewerVerdictIcon,
} from "@/components/Reviews/ReviewPeople";
import { revisionStatusLabel } from "@/components/Reviews/RevisionStatusBadge";
import ApprovalStatusBand from "@/components/Reviews/ApprovalStatusBand";
import DivergenceNotice from "@/components/Reviews/DivergenceNotice";
import { getVariationValueChanges } from "@/components/Experiment/LinkedChanges/linkedFeatureDiff";
import {
  findActiveVerdict,
  rowVisual,
  scanVerdictRetractions,
  VerdictTags,
} from "@/components/Reviews/RevisionTimeline";
import MarkdownWithDiffRefs from "@/components/Reviews/DiffCommentMarkdown";
import CommentCard from "@/components/Comments/CommentCard";
import Avatar from "@/ui/Avatar";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import Button from "@/ui/Button";
import SplitButton from "@/ui/SplitButton";
import Text from "@/ui/Text";
import HelperText from "@/ui/HelperText";
import Link from "@/ui/Link";
import Callout from "@/ui/Callout";
import Checkbox from "@/ui/Checkbox";
import ConfirmDialog from "@/ui/ConfirmDialog";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Field from "@/components/Forms/Field";
import RadioGroup from "@/ui/RadioGroup";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { getEnabledEnvironments, useEnvironments } from "@/services/features";
import useApi from "@/hooks/useApi";
import useOrgSettings from "@/hooks/useOrgSettings";

type ReviewDecision = "Comment" | "Requested Changes" | "Approved";

const logUserId = (l: RevisionLog) =>
  l.user && "id" in l.user ? (l.user as { id: string }).id : null;

type Props = {
  experiment: ExperimentInterfaceStringDates;
  info: LinkedFeatureInfo;
  mutate: () => void;
  /** Overrides the trigger label when the surrounding copy already sets it up. */
  ctaLabel?: string;
  /** Controlled open state, so other surfaces (the checklist) can pop the modal. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export default function ManagedFlagApproval({
  experiment,
  info,
  mutate,
  ctaLabel,
  open: openProp,
  onOpenChange,
}: Props) {
  const { apiCall } = useAuth();
  const { userId, users } = useUser();
  const permissionsUtil = usePermissionsUtil();
  const settings = useOrgSettings();
  const allEnvironments = useEnvironments();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = openProp ?? uncontrolledOpen;
  const setOpen = useCallback(
    (next: boolean) => {
      setUncontrolledOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );
  const [comment, setComment] = useState("");
  const [decision, setDecision] = useState<ReviewDecision>("Comment");
  const [adminBypass, setAdminBypass] = useState(false);
  const [discardConfirm, setDiscardConfirm] = useState(false);
  const [showEnvDetails, setShowEnvDetails] = useState(false);
  const [editingLogId, setEditingLogId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const version = info.pendingDraft?.version;
  // Not gated on `open`: the trigger's label depends on who authored the draft.
  const { data, mutate: mutateRevisions } = useApi<{
    revisions: FeatureRevisionInterface[];
    rampSchedules?: RampScheduleInterface[];
  }>(`/feature/${info.feature.id}`, {
    shouldRun: () => (version ?? null) !== null,
  });
  const revision = useMemo(
    () => data?.revisions?.find((r) => r.version === version),
    [data, version],
  );
  // The values modal doesn't touch this fetch; re-read on open.
  useEffect(() => {
    if (open) mutateRevisions();
  }, [open, mutateRevisions]);

  const liveDiffInput = useMemo(
    () => featureToFeatureRevisionDiffInput(info.feature),
    [info.feature],
  );
  const draftDiffInput = useMemo(
    () =>
      revision
        ? revisionToFeatureRevisionDiffInput(revision, liveDiffInput)
        : liveDiffInput,
    [revision, liveDiffInput],
  );
  const revisionDiffs = useFeatureRevisionDiff({
    current: liveDiffInput,
    draft: draftDiffInput,
    renderMode: "experiment",
  });

  const status = info.pendingDraft?.status ?? "draft";
  const approval = info.pendingDraft?.approval;
  const approvalGated =
    !!approval && !approval.satisfied && status === "approved";
  // Status persists after the org turns approvals off.
  const requireReviews = !!info.pendingDraft?.pendingApproval;
  const approvalGateUnmet = requireReviews && !!approval && !approval.satisfied;
  const reviews = revision?.reviews ?? [];
  const isReviewer = reviews.some((r) => r.userId === userId);

  // Starting the experiment is the publish, so a draft runs review only.
  const publishIsLaunch = experiment.status === "draft";
  // The only place a managed flag's diverged draft can be rebased.
  const liveRevision = data?.revisions?.find(
    (r) => r.version === info.feature.version,
  );
  const baseRevision = data?.revisions?.find(
    (r) => r.version === revision?.baseVersion,
  );
  const mergeResult = useMemo(() => {
    if (!revision || !liveRevision) return null;
    return autoMerge(
      liveRevisionFromFeature(liveRevision, info.feature),
      fillRevisionFromFeature(baseRevision ?? liveRevision, info.feature),
      revision,
      allEnvironments.map((e) => e.id),
      {},
    );
  }, [revision, liveRevision, baseRevision, info.feature, allEnvironments]);

  const [rebasing, setRebasing] = useState(false);
  const updateFromLive = async () => {
    if (!revision || !mergeResult?.success) return;
    setRebasing(true);
    setError(null);
    try {
      await apiCall(`/experiment/${experiment.id}/managed-flag/rebase`, {
        method: "POST",
        body: JSON.stringify({
          mergeResultSerialized: JSON.stringify(mergeResult),
          strategies: {},
        }),
      });
      await Promise.all([mutate(), mutateRevisions()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update from live");
    } finally {
      setRebasing(false);
    }
  };

  const governance = revision
    ? evaluatePublishGovernance({
        revisionStatus: revision.status,
        baseVersion: revision.baseVersion,
        liveVersion: info.feature.version,
        mergeSuccess: !info.pendingDraft?.hasMergeConflict,
        liveChanges: [],
        approvedBaseVersion: revision.approvedBaseVersion ?? null,
        requireRebaseBeforePublish: requireFreshBaseForPublish({
          feature: info.feature,
          reviewRequired: requireReviews,
          orgSetting: !!settings?.requireRebaseBeforePublish,
        }),
      })
    : null;
  const reviewSetting = Array.isArray(settings?.requireReviews)
    ? getReviewSetting(settings.requireReviews, info.feature)
    : undefined;
  const isBlockedContributor =
    !!reviewSetting?.blockSelfApproval &&
    (revision?.contributors ?? []).some((id) => id === userId);

  // An explicit per-publish opt-in, not a standing privilege.
  const adminBypassAvailable =
    !publishIsLaunch &&
    requireReviews &&
    (!(approval?.satisfied ?? status === "approved") ||
      !!governance?.rebaseRequired) &&
    !info.pendingDraft?.hasMergeConflict &&
    (info.pendingDraft?.hasChanges ?? true) &&
    permissionsUtil.canBypassFlagApprovalChecks(info.feature, "feature");

  // Both locks refuse a publish server-side, so the CTA must know about them.
  const featureLockedByRamp =
    data?.rampSchedules?.some(
      (rs) => rs.lockdownConfig?.mode === "locked" && rs.status === "running",
    ) ?? false;
  const featureLockedBySchedule = !!findPublishLockingScheduledRevision(
    data?.revisions ?? [],
    version,
  );

  const stateInput = {
    requireReviews,
    status,
    mergeSuccess: !info.pendingDraft?.hasMergeConflict,
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
    featureLockedByRamp,
    featureLockedBySchedule,
    checklistIncomplete: false,
    checklistBlocked: false,
    checklistAcknowledged: true,
    governanceCanPublish: governance ? governance.canPublish : true,
    editsResetStatus: true,
  };
  const baseState = getReviewAndPublishState({
    ...stateInput,
    adminPublish: false,
  });
  const adminOverride = adminBypassAvailable && adminBypass;
  const state = adminOverride
    ? getReviewAndPublishState({ ...stateInput, adminPublish: true })
    : baseState;

  // The exact footprint needs live and base revisions this modal doesn't load; the server recomputes it.
  const canReview =
    requireReviews &&
    permissionsUtil.canReviewFeatureDrafts(
      info.feature,
      ANY_REVIEW_FOOTPRINT,
    ) &&
    status === "pending-review" &&
    !!revision &&
    revision.createdBy?.id !== userId;

  // `getReviewAndPublishState` carries no authority; gate here too.
  const canPublish = permissionsUtil.canPublishFeature(
    info.feature,
    getEnabledEnvironments(info.feature, allEnvironments),
  );
  const canManage = permissionsUtil.canEditFeatureDrafts(info.feature);

  // Only publish is launch-gated; request-review must stay reachable after a recall or change request.
  const submitAction =
    state.submitAction === "publish" &&
    (publishIsLaunch || (approvalGateUnmet && !adminOverride))
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
    // The parent mutate only refreshes the experiment.
    await Promise.all([mutate(), mutateRevisions(), mutateLog()]);
  }

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
      // The error renders in the body, which is no help if this ran from the
      // trigger's menu with the modal closed.
      setOpen(true);
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
              submitAction === "publish"
                ? { bypassApproval: adminOverride }
                : { comment },
            ),
        }
      : null;

  // Author first, then contributors, as on the Review & Publish tab.
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
    // Stale verdicts still count; the icon mutes.
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

  // Comments live in the revision log.
  const { data: logData, mutate: mutateLog } = useApi<{ log: RevisionLog[] }>(
    `/feature/${info.feature.id}/${version}/log`,
    { shouldRun: () => open && (version ?? null) !== null },
  );
  // Retracted verdicts stay in the thread with a badge.
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
  // `undo-review` acts on the standing verdict, so only that row offers it.
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
  const hasValueChanges = getVariationValueChanges(
    info,
    variations.map((v) => v.id),
  ).some((c) => c.changed);

  // Environments and value type always shown: reviewers judge values against where and as what they go live.
  const liveEnvStates = info.liveEnvironmentStates ?? {};
  const draftEnvStates = info.pendingDraft?.environmentStates ?? liveEnvStates;
  const envIds = filterEnvironmentsByFeature(allEnvironments, info.feature).map(
    (env) => env.id,
  );
  const draftStateOf = (envId: string) =>
    draftEnvStates[envId] ?? liveEnvStates[envId];
  const envToggles = envIds.map((envId) => ({
    envId,
    from: liveEnvStates[envId] === "active",
    to: draftStateOf(envId) === "active",
  }));
  // A managed flag is born with every environment off; its first draft is the
  // flag arriving, not a toggle.
  const arriving = !info.liveEnvironmentStates;
  // Unpacked only when the rule and the switch disagree.
  const envConflict = envIds.some(
    (envId) => draftStateOf(envId) === "disabled-env",
  );
  const environmentsRender = (
    <>
      {renderEnvironmentToggles(envToggles, { endStateOnly: arriving })}
      {envConflict && (
        <Box mt="2">
          <Link
            onClick={() => setShowEnvDetails((v) => !v)}
            weight="medium"
            aria-expanded={showEnvDetails}
          >
            {showEnvDetails ? "Hide details" : "Show details"}
          </Link>
          {showEnvDetails && (
            <Flex direction="column" gap="1" mt="2">
              {envIds.map((envId) => {
                const state = draftStateOf(envId);
                const ruleCovers =
                  state === "active" || state === "disabled-env";
                const switchOn =
                  state === "active" || state === "disabled-rule";
                return (
                  <Text key={envId} size="sm" color="text-mid">
                    <Text weight="medium">{envId}</Text>: experiment{" "}
                    {ruleCovers ? "covers" : "does not cover"} it; the Feature
                    Flag&apos;s environment switch is {switchOn ? "on" : "off"}
                    {state === "disabled-env"
                      ? " — nothing serves here until the switch is turned on."
                      : "."}
                  </Text>
                );
              })}
            </Flex>
          )}
        </Box>
      )}
    </>
  );
  const liveValueType = info.feature.valueType;
  const draftValueType = draftDiffInput.metadata?.valueType ?? liveValueType;
  const sections: FormattedChangeItem[] = [
    {
      title: envToggles.length === 1 ? "Environment" : "Environments",
      a: "",
      b: "",
      customRender: environmentsRender,
    },
    {
      title: "Value type",
      a: "",
      b: "",
      customRender: (
        <Flex align="center" gap="2">
          {draftValueType !== liveValueType && (
            <>
              <Text color="text-low">{liveValueType}</Text>
              <span className="font-weight-bold text-success">→</span>
            </>
          )}
          <Text weight="medium">{draftValueType}</Text>
        </Flex>
      ),
    },
    ...revisionDiffs.filter(
      (d) =>
        d.a !== d.b &&
        d.key !== "environmentsEnabled" &&
        d.key !== "metadata" &&
        // A rule that only moved its environments has no human render here.
        !(d.key === "rules" && !d.customRender),
    ),
  ];

  // Also rendered without a review column: a stale draft still needs Update from live.
  const errorNotice = error && (
    <Callout status="error" size="sm">
      {error}
    </Callout>
  );
  const divergenceNotice = governance && (
    <DivergenceNotice
      subtle
      governance={governance}
      onUpdateFromLive={updateFromLive}
      updating={rebasing}
      canRebase={permissionsUtil.canEditFeatureDrafts(info.feature)}
      liveVersion={info.feature.version}
      baseVersion={revision?.baseVersion ?? info.feature.version}
    />
  );

  const changesColumn = (
    <Flex
      direction="column"
      gap="3"
      flexGrow="1"
      width={requireReviews ? undefined : "100%"}
      minWidth="0"
    >
      <Text size="lg" weight="semibold" color="text-high">
        Changes
      </Text>
      <FormattedChanges diffs={sections} />
    </Flex>
  );

  const awaitingApproval =
    requireReviews &&
    !adminOverride &&
    !(approval?.satisfied ?? status === "approved");
  // "Once approved" contradicts an "Approved" label.
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

  const showApprovalBand =
    requireReviews &&
    !!info.pendingDraft &&
    (status !== "approved" || approvalGateUnmet) &&
    // Suppressed beside a working CTA, but ours isn't working while a gate is unmet.
    (approvalGateUnmet || baseState.submitAction !== "publish");
  const coverageBlockMessage =
    approval &&
    !approval.unmetTeams.length &&
    approval.insufficientApprovers.length
      ? "None of this draft's approvals cover everything it changes."
      : null;

  const reviewColumn = (
    <Flex direction="column" gap="3" width="360px" flexShrink="0" minWidth="0">
      {contributorRows.length > 0 && (
        <Box>
          <Text size="lg" weight="medium" color="text-high" as="div" mb="2">
            Contributors
          </Text>
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

      {errorNotice}

      {showApprovalBand && (
        <ApprovalStatusBand
          phase={
            status === "approved"
              ? "gated"
              : baseState.waitingForReview &&
                  !canReview &&
                  !adminBypassAvailable
                ? "waiting"
                : "draft"
          }
          footprint={approval?.footprint}
          unmet={approval?.unmetTeams ?? []}
          coverageMessage={coverageBlockMessage}
          showSelfApprovalNote={isBlockedContributor && canReview}
          subtle
        />
      )}

      {divergenceNotice}

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
              const visual = rowVisual(l.action);
              const verdictColor =
                l.action === "Approved"
                  ? "green"
                  : l.action === "Requested Changes"
                    ? "red"
                    : null;
              const isOwn = !!logUserId(l) && logUserId(l) === userId;
              // A row with neither action would open an empty menu.
              const canEditRow = isOwn && !!l.id && !!l.comment;
              const canRetractRow =
                isOwn && !!l.isActiveVerdict && state.canUndoReview;
              const uncoveredReason =
                l.action === "Approved" && logUserId(l)
                  ? insufficientReasons.get(logUserId(l) as string)
                  : undefined;
              return (
                <CommentCard
                  key={l.id ?? i}
                  user={l.user}
                  metadata={`${visual.verb}: ${datetime(l.timestamp)}`}
                  metadataExtra={
                    <VerdictTags
                      uncoveredReason={uncoveredReason}
                      retraction={l.retraction}
                    />
                  }
                  stripeColor={visual.color}
                  leading={
                    verdictColor ? (
                      <Avatar
                        size="sm"
                        color={verdictColor}
                        variant={uncoveredReason ? "soft" : "solid"}
                        ring={!!uncoveredReason}
                      >
                        <>{visual.icon}</>
                      </Avatar>
                    ) : undefined
                  }
                  avatarSize="sm"
                  compact
                  actions={
                    canEditRow || canRetractRow ? (
                      <DropdownMenu
                        trigger={
                          <IconButton
                            variant="ghost"
                            color="gray"
                            radius="full"
                            size="1"
                            highContrast
                            aria-label="Comment actions"
                          >
                            <BsThreeDotsVertical size={14} />
                          </IconButton>
                        }
                        menuPlacement="end"
                      >
                        {canEditRow && (
                          <DropdownMenuItem
                            onClick={() => {
                              setEditingLogId(l.id ?? null);
                              setEditText(l.comment ?? "");
                            }}
                          >
                            Edit
                          </DropdownMenuItem>
                        )}
                        {canRetractRow && (
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
      <SplitButton
        menu={
          state.canRecallReview || canManage ? (
            <DropdownMenu
              trigger={
                <Button aria-label="Review actions">
                  <PiCaretDownFill />
                </Button>
              }
              menuPlacement="end"
              variant="soft"
            >
              {state.canRecallReview && (
                <DropdownMenuItem
                  disabled={submitting}
                  onClick={() => post("recall-review")}
                >
                  Return to draft
                </DropdownMenuItem>
              )}
              {canManage && (
                <DropdownMenuItem
                  color="red"
                  disabled={submitting}
                  onClick={() => setDiscardConfirm(true)}
                >
                  Discard draft
                </DropdownMenuItem>
              )}
            </DropdownMenu>
          ) : undefined
        }
      >
        <Button onClick={() => setOpen(true)}>
          {ctaLabel ??
            (canReview
              ? "Review"
              : showSubmit
                ? state.ctaLabel
                : "Review changes")}
        </Button>
      </SplitButton>
      {discardConfirm && (
        <ConfirmDialog
          title="Discard unpublished variation values?"
          content="This throws away the unpublished draft. Live values are unchanged."
          yesText="Discard"
          onConfirm={async () => {
            setDiscardConfirm(false);
            await post("discard");
          }}
          onCancel={() => setDiscardConfirm(false)}
        />
      )}
      <ModalStandard
        open={open}
        trackingEventModalType="managed-flag-approval"
        trackingEventModalSource="experiment-overview"
        header={hasValueChanges ? "Review Value Changes" : "Review Values"}
        hideHeader
        bodyMb="0"
        size="xl"
        close={() => {
          // The override is per publish, so it must not survive the modal.
          setAdminBypass(false);
          setOpen(false);
        }}
        closeCta={primaryAction ? "Cancel" : "Close"}
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
          <Flex direction="column" width="100%" gap="3">
            {changesColumn}
            {errorNotice}
            {divergenceNotice}
          </Flex>
        )}
      </ModalStandard>
    </>
  );
}
