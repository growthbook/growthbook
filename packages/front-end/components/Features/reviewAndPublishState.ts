import { FeatureRevisionInterface } from "shared/types/feature-revision";

// Pure decision logic for the consolidated ReviewAndPublish surface. This
// captures the CTA label, enablement, and submit routing that previously lived
// (and drifted) across DraftModal and RequestReviewModal, plus the conflict
// and submit-review sub-modes. Keeping it pure makes the full lifecycle/CTA
// matrix unit-testable without rendering the heavy modal tree.

export type RnPMode = "fix-conflicts" | "main";

// What the primary CTA does when clicked.
export type RnPSubmitAction =
  | "next-experiments" // advance to the pre-launch checklist step
  | "request-review" // POST /request
  | "publish" // POST /publish
  | "none"; // no submit handler (view-only)

export interface RnPStateInput {
  // Org/feature requires approval before publishing.
  requireReviews: boolean;
  status: FeatureRevisionInterface["status"];
  // autoMerge succeeded (no unresolved conflicts).
  mergeSuccess: boolean;
  // There is something to publish.
  hasChanges: boolean;
  // Raw `canReviewFeatureDrafts` permission, independent of revision state.
  // Used to gate retraction of an existing verdict — a reviewer who approved
  // earlier (status now "approved") must still be allowed to retract.
  hasReviewPermission: boolean;
  // The current user is the draft author (or co-author) and can manage drafts.
  canManageDraft: boolean;
  // The current user is the one who most recently submitted the review request
  // — they're the only one who can retract it.
  isReviewRequester: boolean;
  // The current user has an active reviewer verdict on this revision —
  // they're the only one who can retract it.
  isReviewer: boolean;
  // Admin opted to bypass approval/lockdown/governance.
  adminPublish: boolean;
  // At least one experiment is selected to start on publish.
  hasSelectedExperiments: boolean;
  // Only future-scheduled experiments are selected (changes CTA wording).
  onlyScheduledSelected: boolean;
  // Currently on the pre-launch checklist step.
  experimentsStep: boolean;
  featureLockedByRamp: boolean;
  // A selected experiment's required checklist is incomplete/loading.
  checklistBlocked: boolean;
  // Governance allows publishing (false when a stale draft must be rebased).
  governanceCanPublish: boolean;
}

export interface RnPState {
  mode: RnPMode;
  ctaLabel: string;
  ctaEnabled: boolean;
  // Show a lock glyph on the CTA (publishing through a ramp lockdown).
  ctaLocked: boolean;
  submitAction: RnPSubmitAction;
  // Whether the main modal wires up a submit handler at all.
  hasSubmit: boolean;
  // Secondary actions shown as links/ghost buttons alongside the primary CTA.
  // Author retracts the review request → back to draft.
  canRecallReview: boolean;
  // Reviewer retracts their own verdict → back to pending-review.
  canUndoReview: boolean;
}

function publishLabel(
  featureLockedByRamp: boolean,
  onlyScheduledSelected: boolean,
): string {
  if (featureLockedByRamp) return "Publish";
  if (onlyScheduledSelected) return "Schedule to Start";
  return "Publish";
}

export function getReviewAndPublishState(input: RnPStateInput): RnPState {
  const {
    requireReviews,
    status,
    mergeSuccess,
    hasChanges,
    hasReviewPermission,
    canManageDraft,
    isReviewRequester,
    isReviewer,
    adminPublish,
    hasSelectedExperiments,
    onlyScheduledSelected,
    experimentsStep,
    featureLockedByRamp,
    checklistBlocked,
    governanceCanPublish,
  } = input;

  // recall-review: only the user who submitted the latest review request can
  // pull it back (and they need draft-manage permission). Other draft managers
  // shouldn't be able to retract someone else's review request.
  const recallableStatuses = [
    "pending-review",
    "changes-requested",
    "approved",
  ];
  const canRecallReview =
    canManageDraft && isReviewRequester && recallableStatuses.includes(status);

  // undo-review: only the reviewer who submitted the verdict can retract it.
  // Uses `hasReviewPermission` (not the state-gated `canReview`) so an
  // approver can still pull back their verdict after status flipped to
  // "approved".
  const undoableStatuses = ["approved", "changes-requested"];
  const canUndoReview =
    hasReviewPermission && isReviewer && undoableStatuses.includes(status);

  // Hard conflicts block publishing (never bypassable), but the review
  // workflow — requesting reviews, submitting verdicts, retracting — stays
  // available so the conversation can continue while conflicts are resolved.
  const mode: RnPMode = mergeSuccess ? "main" : "fix-conflicts";

  const isPendingReview =
    status === "pending-review" || status === "changes-requested";
  const approved = status === "approved" || adminPublish;

  // ── Direct-publish path (approvals not required) ──
  if (!requireReviews) {
    const hasNextStep =
      mergeSuccess && hasChanges && hasSelectedExperiments && !experimentsStep;
    // Admins can bypass a forced rebase (governance), but never unresolved
    // merge conflicts — those are handled by the fix-conflicts mode above.
    const ctaEnabled =
      mergeSuccess &&
      hasChanges &&
      (!featureLockedByRamp || adminPublish) &&
      (governanceCanPublish || adminPublish);
    return {
      mode,
      ctaLabel: hasNextStep
        ? "Next"
        : publishLabel(featureLockedByRamp, onlyScheduledSelected),
      ctaEnabled,
      ctaLocked: !hasNextStep && featureLockedByRamp,
      submitAction: hasNextStep ? "next-experiments" : "publish",
      hasSubmit: true,
      canRecallReview,
      canUndoReview,
    };
  }

  // ── Review path (approvals required) ──
  const hasNextStep =
    mergeSuccess && approved && hasSelectedExperiments && !experimentsStep;

  let ctaLabel = "Request Review";
  let ctaLocked = false;
  if (approved && !hasNextStep) {
    ctaLabel = publishLabel(featureLockedByRamp, onlyScheduledSelected);
    ctaLocked = featureLockedByRamp;
  } else if (hasNextStep) {
    ctaLabel = "Next";
  }

  let submitAction: RnPSubmitAction;
  if (hasNextStep) {
    submitAction = "next-experiments";
  } else if (!isPendingReview && !approved) {
    submitAction = "request-review";
  } else if (approved) {
    submitAction = "publish";
  } else {
    submitAction = "none";
  }

  // A pending-review draft is read-only for non-reviewers; approved drafts and
  // request-review actions have step CTAs. Reviewers use the ReviewCommentPopover.
  const hasSubmit = !isPendingReview || approved;

  const ctaEnabled =
    !(experimentsStep && checklistBlocked && !adminPublish) &&
    (!featureLockedByRamp || adminPublish) &&
    !(approved && !governanceCanPublish && !adminPublish) &&
    // Publishing is the only action a conflict blocks — request-review
    // remains enabled so the review cycle can start regardless.
    (mergeSuccess || submitAction === "request-review");

  return {
    mode,
    ctaLabel,
    ctaEnabled,
    ctaLocked,
    submitAction,
    hasSubmit,
    canRecallReview,
    canUndoReview,
  };
}
