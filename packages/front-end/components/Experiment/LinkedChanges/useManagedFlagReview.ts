import { useEffect, useMemo, useRef, useState } from "react";
import {
  ANY_REVIEW_FOOTPRINT,
  autoMerge,
  evaluatePublishGovernance,
  fillRevisionFromFeature,
  getReviewSetting,
  liveRevisionFromFeature,
  requireFreshBaseForPublish,
} from "shared/util";
import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import {
  FeatureRevisionInterface,
  RevisionLog,
} from "shared/types/feature-revision";
import {
  findPublishLockingScheduledRevision,
  isInReviewCycle,
} from "shared/enterprise";
import { RampScheduleInterface } from "shared/validators";
import { getReviewAndPublishState } from "@/components/Reviews/reviewAndPublishState";
import {
  findActiveVerdict,
  scanVerdictRetractions,
  sortRevisionLog,
} from "@/components/Reviews/RevisionTimeline";
import { reviewCommentsFromLog } from "@/components/Reviews/ReviewCommentCard";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { getEnabledEnvironments, useEnvironments } from "@/services/features";
import useApi from "@/hooks/useApi";
import useOrgSettings from "@/hooks/useOrgSettings";

export type ManagedFlagReview = ReturnType<typeof useManagedFlagReview>;

/** The review state and actions of an experiment's Values flag draft. */
export default function useManagedFlagReview({
  experiment,
  info,
  mutate,
}: {
  experiment: ExperimentInterfaceStringDates;
  info: LinkedFeatureInfo;
  mutate: () => void;
}) {
  const { apiCall } = useAuth();
  const { userId } = useUser();
  const permissionsUtil = usePermissionsUtil();
  const settings = useOrgSettings();
  const allEnvironments = useEnvironments();
  const [adminBypass, setAdminBypass] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const version = info.pendingDraft?.version;
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
  // Comments live in the revision log.
  const { data: logData, mutate: mutateLog } = useApi<{ log: RevisionLog[] }>(
    `/feature/${info.feature.id}/${version}/log`,
    { shouldRun: () => (version ?? null) !== null },
  );
  // A save from the page writes the same version, so its keys don't change;
  // refetch when the draft moves, not on mount, which already fetched.
  const draftStamp = info.pendingDraft?.dateUpdated ?? null;
  const seenStamp = useRef(draftStamp);
  useEffect(() => {
    if (seenStamp.current === draftStamp) return;
    seenStamp.current = draftStamp;
    if (draftStamp === null) return;
    void mutateRevisions();
    void mutateLog();
  }, [draftStamp, mutateRevisions, mutateLog]);
  // Retracted verdicts stay in the thread with a badge.
  const sortedLog = useMemo(
    () => sortRevisionLog(logData?.log ?? []),
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
  const reviewComments = reviewCommentsFromLog(
    sortedLog,
    retractions,
    activeVerdict,
  );

  const status = info.pendingDraft?.status ?? "draft";
  const approval = info.pendingDraft?.approval;
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

  // `getReviewAndPublishState` carries no authority; gate here too.
  const canPublish = permissionsUtil.canPublishFeature(
    info.feature,
    getEnabledEnvironments(info.feature, allEnvironments),
  );
  // An explicit per-publish opt-in, not a standing privilege, and only for
  // someone the publish would then let through.
  const adminBypassAvailable =
    !publishIsLaunch &&
    requireReviews &&
    (!(approval?.satisfied ?? status === "approved") ||
      !!governance?.rebaseRequired) &&
    !info.pendingDraft?.hasMergeConflict &&
    (info.pendingDraft?.hasChanges ?? true) &&
    canPublish &&
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

  // The exact footprint needs live and base revisions this hook doesn't load; the server recomputes it.
  const canReview =
    requireReviews &&
    permissionsUtil.canReviewFeatureDrafts(
      info.feature,
      ANY_REVIEW_FOOTPRINT,
    ) &&
    isInReviewCycle(status) &&
    !!revision &&
    revision.createdBy?.id !== userId;

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

  // The parent mutate only refreshes the experiment.
  const refresh = () => Promise.all([mutate(), mutateRevisions(), mutateLog()]);

  async function runAction(
    path: string,
    body: Record<string, unknown> = {},
    method: "POST" | "PUT" = "POST",
  ) {
    await apiCall(`/experiment/${experiment.id}/managed-flag/${path}`, {
      method,
      body: JSON.stringify(body),
    });
    await refresh();
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
    } finally {
      setSubmitting(false);
    }
  }

  // The author's or publisher's next step; reviewers submit a review instead.
  const submit = showSubmit
    ? {
        label: state.ctaLabel,
        enabled: state.ctaEnabled,
        action: submitAction,
        run: () =>
          runAction(
            submitAction === "publish" ? "publish" : "request-review",
            submitAction === "publish" ? { bypassApproval: adminOverride } : {},
          ),
      }
    : null;

  const insufficientReasons = useMemo(
    () =>
      new Map(
        (approval?.insufficientApprovers ?? []).map((a) => [a.id, a.reason]),
      ),
    [approval],
  );

  const showApprovalBand =
    requireReviews &&
    !!info.pendingDraft &&
    (status !== "approved" || approvalGateUnmet) &&
    // Suppressed beside a working CTA, but ours isn't working while a gate is unmet.
    (approvalGateUnmet || baseState.submitAction !== "publish");
  const approvalBandPhase: "gated" | "waiting" | "draft" =
    status === "approved"
      ? "gated"
      : baseState.waitingForReview && !canReview && !adminBypassAvailable
        ? "waiting"
        : "draft";
  const coverageBlockMessage =
    approval &&
    !approval.unmetTeams.length &&
    approval.insufficientApprovers.length &&
    !approval.hasCoveringApproval
      ? "None of this draft's approvals cover everything it changes."
      : null;

  return {
    version,
    revision,
    status,
    approval,
    requireReviews,
    publishIsLaunch,
    reviews,
    insufficientReasons,
    reviewComments,
    governance,
    isBlockedContributor,
    state,
    canReview,
    canManage,
    submit,
    adminBypassAvailable,
    adminBypass,
    setAdminBypass,
    updateFromLive,
    rebasing,
    refresh,
    post,
    submitting,
    error,
    showApprovalBand,
    approvalBandPhase,
    coverageBlockMessage,
  };
}
