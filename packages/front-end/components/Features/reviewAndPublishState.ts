import { FeatureRevisionInterface } from "shared/types/feature-revision";

// Pure decision logic for the consolidated ReviewAndPublish surface. This
// captures the CTA label, enablement, and submit routing that previously lived
// (and drifted) across DraftModal and RequestReviewModal, plus the conflict
// and submit-review sub-modes. Keeping it pure makes the full lifecycle/CTA
// matrix unit-testable without rendering the heavy modal tree.

export type RnPMode = "fix-conflicts" | "submit-review" | "main";

// What the primary CTA does when clicked.
export type RnPSubmitAction =
  | "next-experiments" // advance to the pre-launch checklist step
  | "request-review" // POST /request
  | "publish" // POST /publish
  | "show-submit-review" // open the approve/request-changes sub-view
  | "none"; // no submit handler (view-only)

export interface RnPStateInput {
  // Org/feature requires approval before publishing.
  requireReviews: boolean;
  status: FeatureRevisionInterface["status"];
  // autoMerge succeeded (no unresolved conflicts).
  mergeSuccess: boolean;
  // There is something to publish.
  hasChanges: boolean;
  // Viewer may submit a review (pending, not the author, has permission).
  canReview: boolean;
  // Admin opted to bypass approval/lockdown/governance.
  adminPublish: boolean;
  // At least one experiment is selected to start on publish.
  hasSelectedExperiments: boolean;
  // Only future-scheduled experiments are selected (changes CTA wording).
  onlyScheduledSelected: boolean;
  // Currently on the pre-launch checklist step.
  experimentsStep: boolean;
  // The approve/request-changes sub-view is showing.
  showSubmitReview: boolean;
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
    canReview,
    adminPublish,
    hasSelectedExperiments,
    onlyScheduledSelected,
    experimentsStep,
    showSubmitReview,
    featureLockedByRamp,
    checklistBlocked,
    governanceCanPublish,
  } = input;

  // Hard conflicts always route to the conflict-resolution flow first.
  if (!mergeSuccess) {
    return {
      mode: "fix-conflicts",
      ctaLabel: "Update Draft",
      ctaEnabled: false, // enabled once all conflicts are resolved (handled in-view)
      ctaLocked: false,
      submitAction: "none",
      hasSubmit: true,
    };
  }

  if (showSubmitReview) {
    return {
      mode: "submit-review",
      ctaLabel: "Submit",
      ctaEnabled: true,
      ctaLocked: false,
      submitAction: "none", // submit handled by the sub-view's own form
      hasSubmit: true,
    };
  }

  const isPendingReview =
    status === "pending-review" || status === "changes-requested";
  const approved = status === "approved" || adminPublish;

  // ── Direct-publish path (approvals not required) ──
  if (!requireReviews) {
    const hasNextStep =
      mergeSuccess && hasChanges && hasSelectedExperiments && !experimentsStep;
    const ctaEnabled =
      mergeSuccess &&
      hasChanges &&
      (!featureLockedByRamp || adminPublish) &&
      governanceCanPublish;
    return {
      mode: "main",
      ctaLabel: hasNextStep
        ? "Next"
        : publishLabel(featureLockedByRamp, onlyScheduledSelected),
      ctaEnabled,
      ctaLocked: !hasNextStep && featureLockedByRamp,
      submitAction: hasNextStep ? "next-experiments" : "publish",
      hasSubmit: true,
    };
  }

  // ── Review path (approvals required) ──
  const hasNextStep = approved && hasSelectedExperiments && !experimentsStep;

  let ctaLabel = "Request Review";
  let ctaLocked = false;
  if (approved && !hasNextStep) {
    ctaLabel = publishLabel(featureLockedByRamp, onlyScheduledSelected);
    ctaLocked = featureLockedByRamp;
  } else if (canReview || hasNextStep) {
    ctaLabel = "Next";
  }

  let submitAction: RnPSubmitAction;
  if (hasNextStep) {
    submitAction = "next-experiments";
  } else if (!isPendingReview && !approved) {
    submitAction = "request-review";
  } else if (approved) {
    submitAction = "publish";
  } else if (canReview) {
    submitAction = "show-submit-review";
  } else {
    submitAction = "none";
  }

  // A pending-review draft is read-only for non-reviewers (no submit handler);
  // reviewers and the approved/draft author keep an actionable CTA.
  const hasSubmit = !isPendingReview || canReview || approved;

  const ctaEnabled =
    !(experimentsStep && checklistBlocked && !adminPublish) &&
    (!featureLockedByRamp || adminPublish) &&
    !(approved && !governanceCanPublish && !adminPublish);

  return {
    mode: "main",
    ctaLabel,
    ctaEnabled,
    ctaLocked,
    submitAction,
    hasSubmit,
  };
}
