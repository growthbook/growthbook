import type { RevisionStatus } from "shared/validators";

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
  status: RevisionStatus;
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
  // The current user is the one who most recently submitted the review request.
  isReviewRequester: boolean;
  // The current user is the revision author or a contributor (their edits
  // touched the revision). Contributors share ownership of the draft, so they
  // can return it to draft even if someone else requested the review.
  isContributor: boolean;
  /** Whether this engine considers the caller an owner allowed to recall. */
  isDraftOwner: boolean;
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
  // Publishing is frozen by an active ramp-schedule lockdown on this feature.
  featureLockedByRamp: boolean;
  // Publishing is frozen by a sibling draft's scheduled publish that locks other
  // drafts. Treated identically to the ramp lock.
  featureLockedBySchedule: boolean;
  checklistIncomplete: boolean;
  checklistBlocked: boolean;
  checklistAcknowledged: boolean;
  // Governance allows publishing (false when a stale draft must be rebased).
  governanceCanPublish: boolean;
  /** Feature edits reset changes-requested to draft; generic revision edits do not. */
  editsResetStatus: boolean;
}

export interface RnPState {
  mode: RnPMode;
  ctaLabel: string;
  ctaEnabled: boolean;
  // Show a lock glyph on the CTA (frozen by a ramp or scheduled-publish lock).
  ctaLocked: boolean;
  submitAction: RnPSubmitAction;
  // Whether the main modal wires up a submit handler at all.
  hasSubmit: boolean;
  showChecklistAcknowledgment: boolean;
  // Secondary actions shown as links/ghost buttons alongside the primary CTA.
  // Requester/author/contributor returns the revision to draft (retracting the
  // review request).
  canRecallReview: boolean;
  // Reviewer retracts their own verdict → back to pending-review.
  canUndoReview: boolean;
  // The draft sits in pending review with no primary action for this viewer.
  // Consumers must render an explicit waiting status in the CTA's place —
  // with no reviewer verdicts yet, the page otherwise shows nothing but a
  // status badge and reads as stuck.
  waitingForReview: boolean;
}

function publishLabel(
  publishLocked: boolean,
  onlyScheduledSelected: boolean,
): string {
  if (publishLocked) return "Publish";
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
    isContributor,
    isDraftOwner,
    isReviewer,
    adminPublish,
    hasSelectedExperiments,
    onlyScheduledSelected,
    experimentsStep,
    featureLockedByRamp,
    featureLockedBySchedule,
    checklistIncomplete,
    checklistBlocked,
    checklistAcknowledged,
    governanceCanPublish,
    editsResetStatus,
  } = input;

  // Ramp and scheduled-publish locks freeze publishing identically (lock glyph,
  // admin-bypassable), so collapse them into one concept below.
  const publishLocked = featureLockedByRamp || featureLockedBySchedule;

  const checklistGateOpen = !(
    experimentsStep &&
    checklistIncomplete &&
    (checklistBlocked || (!adminPublish && !checklistAcknowledged))
  );
  const softChecklistOnly =
    experimentsStep &&
    checklistIncomplete &&
    !checklistBlocked &&
    !adminPublish;

  // Owners may recall in-review drafts; other participants also need draft authority.
  const recallableStatuses = [
    "pending-review",
    "changes-requested",
    "approved",
  ];
  const canRecallReview =
    (isDraftOwner ||
      (canManageDraft && (isReviewRequester || isContributor))) &&
    recallableStatuses.includes(status);

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
    const baseEnabled =
      mergeSuccess &&
      hasChanges &&
      (!publishLocked || adminPublish) &&
      (governanceCanPublish || adminPublish);
    const showChecklistAcknowledgment =
      !hasNextStep && softChecklistOnly && baseEnabled;
    return {
      mode,
      ctaLabel: hasNextStep
        ? "Next"
        : publishLabel(publishLocked, onlyScheduledSelected),
      ctaEnabled: baseEnabled && checklistGateOpen,
      ctaLocked: !hasNextStep && publishLocked,
      submitAction: hasNextStep ? "next-experiments" : "publish",
      hasSubmit: true,
      canRecallReview,
      canUndoReview,
      waitingForReview: false,
      showChecklistAcknowledgment,
    };
  }

  // ── Review path (approvals required) ──
  const hasNextStep =
    mergeSuccess && approved && hasSelectedExperiments && !experimentsStep;

  const canResubmit = !editsResetStatus && status === "changes-requested";

  let ctaLabel = canResubmit ? "Re-request Review" : "Request Review";
  let ctaLocked = false;
  if (approved && !hasNextStep) {
    ctaLabel = publishLabel(publishLocked, onlyScheduledSelected);
    ctaLocked = publishLocked;
  } else if (hasNextStep) {
    ctaLabel = "Next";
  }

  let submitAction: RnPSubmitAction;
  if (hasNextStep) {
    submitAction = "next-experiments";
  } else if ((!isPendingReview && !approved) || canResubmit) {
    submitAction = "request-review";
  } else if (approved) {
    submitAction = "publish";
  } else {
    submitAction = "none";
  }

  const hasSubmit = !isPendingReview || approved || canResubmit;

  const waitingForReview = status === "pending-review" && !approved;

  const baseEnabled =
    (!publishLocked || adminPublish) &&
    !(approved && !governanceCanPublish && !adminPublish) &&
    // Publishing is the only action a conflict blocks — request-review
    // remains enabled so the review cycle can start regardless.
    (mergeSuccess || submitAction === "request-review");

  const ctaEnabled = checklistGateOpen && baseEnabled;
  const showChecklistAcknowledgment =
    submitAction === "publish" && softChecklistOnly && baseEnabled;

  return {
    mode,
    ctaLabel,
    ctaEnabled,
    ctaLocked,
    submitAction,
    hasSubmit,
    canRecallReview,
    canUndoReview,
    waitingForReview,
    showChecklistAcknowledgment,
  };
}
