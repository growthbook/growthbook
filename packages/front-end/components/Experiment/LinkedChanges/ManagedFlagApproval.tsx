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

// CTA + reviewers only: a managed flag has one rule and one draft, so the
// Review & Publish tab's deferral and diff machinery has nothing to act on.
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
  // The values modal saves through the experiment's mutate, which does not
  // touch this feature fetch; re-read on open or the diff shows the old draft.
  useEffect(() => {
    if (open) mutateRevisions();
  }, [open, mutateRevisions]);

  // The Feature Flag's own review engine. A managed flag's draft IS the
  // experiment's change, so the whole-revision diff is the right unit — and if
  // anything else ever lands in there, this is what would show it.
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
  // Approved on paper, blocked in practice.
  const approvalGated =
    !!approval && !approval.satisfied && status === "approved";
  // A revision keeps the status it was left in, so a draft opened while
  // approvals were on stays "pending-review" after the org turns them off.
  const requireReviews = !!info.pendingDraft?.pendingApproval;
  const approvalGateUnmet = requireReviews && !!approval && !approval.satisfied;
  const reviews = revision?.reviews ?? [];
  const isReviewer = reviews.some((r) => r.userId === userId);

  // Starting the experiment is the publish, so a draft runs review only.
  const publishIsLaunch = experiment.status === "draft";
  // A managed flag has no Review & Publish tab of its own, so this is the only
  // place a diverged draft can be rebased. Same merge and call as that page.
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

  // The same inputs the auto-publish path feeds the gate, so the notice and the
  // refusal agree on whether live has moved past this draft.
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
  // Contributors can't approve their own draft when the org says so, which is
  // not self-evident from a missing radio.
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
    featureLockedByRamp,
    featureLockedBySchedule,
    checklistIncomplete: false,
    checklistBlocked: false,
    checklistAcknowledged: true,
    governanceCanPublish: governance ? governance.canPublish : true,
    editsResetStatus: true,
  };
  // Two reads: the bypass changes the CTA, the banners still say what it skips.
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
  // And while the gate is unmet: the state machine sees only the status.
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
  // Only names the modal; the diff itself comes from the shared engine.
  const hasValueChanges = getVariationValueChanges(
    info,
    variations.map((v) => v.id),
  ).some((c) => c.changed);

  // Environments and value type are always shown, changed or not: a reviewer
  // judges the values against where they will be live and what type they are.
  // Where the experiment actually runs: the rule's environment scope and the
  // flag's kill switches together, live against draft.
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
  // The grid shows the effective state. It only needs unpacking when the two
  // knobs disagree: the rule covers an environment whose switch is off.
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
            {showEnvDetails ? "Hide details" : "Details"}
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
    // The experiment can only re-type the flag's settings, and the card above
    // already says so.
    ...revisionDiffs.filter(
      (d) =>
        d.a !== d.b &&
        d.key !== "environmentsEnabled" &&
        d.key !== "metadata" &&
        // A rule that only moved its environments has no human render here.
        !(d.key === "rules" && !d.customRender),
    ),
  ];

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

  // Approval is the first gate, so say so — otherwise the notice reads as
  // though starting the experiment is all that stands in the way.
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

  // The Review & Publish tab's own band logic, so both surfaces explain a
  // blocked publish at the same point in the cycle and in the same words.
  const showApprovalBand =
    requireReviews &&
    !!info.pendingDraft &&
    (status !== "approved" || approvalGateUnmet) &&
    // The tab suppresses the band beside a working Publish CTA. Ours is not
    // working while a gate is unmet — the state machine is not told about team
    // or footprint coverage, so it offers a publish the server would refuse.
    // baseState, not state: an armed admin override still shows what it skips.
    (approvalGateUnmet || baseState.submitAction !== "publish");
  const coverageBlockMessage =
    approval &&
    !approval.unmetTeams.length &&
    approval.insufficientApprovers.length
      ? "None of this draft's approvals cover everything it changes."
      : null;

  const reviewColumn = (
    // Held at the width it had before the modal grew, so the extra room goes
    // to the diff rather than stretching a column of names.
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

      {governance && (
        <DivergenceNotice
          subtle
          governance={governance}
          onUpdateFromLive={updateFromLive}
          updating={rebasing}
          canRebase={permissionsUtil.canEditFeatureDrafts(info.feature)}
          liveVersion={info.feature.version}
          baseVersion={revision?.baseVersion ?? info.feature.version}
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
              // Derived before the trigger renders: a row with neither action
              // (an own review request carries no comment to edit) would
              // otherwise open an empty menu.
              const canEditRow = isOwn && !!l.id && !!l.comment;
              const canRetractRow =
                isOwn && !!l.isActiveVerdict && state.canUndoReview;
              // An approval that cannot sanction the publish reads as one here
              // too, so the thread and the Reviewers list agree.
              const uncoveredReason =
                l.action === "Approved" && logUserId(l)
                  ? insufficientReasons.get(logUserId(l) as string)
                  : undefined;
              return (
                <CommentCard
                  key={l.id ?? i}
                  user={l.user}
                  // Colon, not "on": this column is half a modal wide and the
                  // phrase has to hold one line.
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
      <SplitButton
        // Beside the CTA rather than inside the modal: recalling the request
        // is an alternative to reviewing it, not part of reviewing it.
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
          {/* A caller-supplied label wins for everyone, so one callout can't
              show two different CTAs. Otherwise name what the modal offers this
              viewer; with no action it is still worth opening to see the
              changes and who has reviewed. */}
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
