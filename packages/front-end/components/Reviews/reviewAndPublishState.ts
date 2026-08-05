import type { RevisionStatus } from "shared/validators";

// Pure, entity-agnostic decision logic for the review-and-publish CTA
// lifecycle. Lives in components/Reviews/ (the shared core) and is consumed by
// entity-specific adapters (e.g. components/Reviews/Feature/ReviewAndPublish).
//
// Relationship to components/Revision/: that namespace is the newer generic
// revision system (RevisionModel + EntityRevisionAdapter) currently serving
// saved groups. This module belongs to the older feature-revision pipeline.
// Once feature revisions converge onto the generic system, this state machine
// can be unified with the generic revision approval logic — until then the two
// coexist as separate UI flows sharing the same entity-agnostic concepts.

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
  // A selected experiment's required checklist is incomplete or still loading.
  // Disables the primary publish CTA on the checklist step.
  checklistIncomplete: boolean;
  // A selected experiment has an incomplete hard blocker (merge conflict,
  // missing approval or unrelated changes on another linked draft), or a
  // checklist is still loading. Non-bypassable by ANYONE — including an admin
  // bypass — because auto-publishing the experiment's other linked drafts would
  // fail or silently ship unreviewed changes. No "publish anyway" is offered.
  // Soft-only blockers (checklistIncomplete && !checklistBlocked) can be
  // acknowledged, matching the experiment dashboard's "start anyway" flow.
  checklistBlocked: boolean;
  // Governance allows publishing (false when a stale draft must be rebased).
  governanceCanPublish: boolean;
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
  // Soft checklist blockers can be acknowledged: show a secondary
  // "publish/schedule anyway" action that runs the same publish submitAction,
  // bypassing the checklist gate only. False while loading, when any hard
  // blocker exists, or when publishing is otherwise disallowed.
  canPublishAnyway: boolean;
  // Label for the acknowledgment action ("Publish anyway"/"Schedule anyway").
  publishAnywayLabel: string;
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
    isReviewer,
    adminPublish,
    hasSelectedExperiments,
    onlyScheduledSelected,
    experimentsStep,
    featureLockedByRamp,
    featureLockedBySchedule,
    checklistIncomplete,
    checklistBlocked,
    governanceCanPublish,
  } = input;

  // Ramp and scheduled-publish locks freeze publishing identically (lock glyph,
  // admin-bypassable), so collapse them into one concept below.
  const publishLocked = featureLockedByRamp || featureLockedBySchedule;

  // The checklist gate disables the primary publish CTA on the checklist step.
  // Hard blockers (checklistBlocked) always close it — an admin bypass does NOT
  // override them, since auto-publishing the experiment's other linked drafts
  // would fail or silently ship unreviewed changes. Soft-only blockers just
  // hold the CTA until they're acknowledged ("publish anyway") or an admin
  // bypasses them.
  const checklistGateOpen = !(
    experimentsStep &&
    checklistIncomplete &&
    (checklistBlocked || !adminPublish)
  );
  const softChecklistOnly =
    experimentsStep &&
    checklistIncomplete &&
    !checklistBlocked &&
    !adminPublish;
  const publishAnywayLabel = onlyScheduledSelected
    ? "Schedule anyway"
    : "Publish anyway";

  // recall-review ("Return to draft"): the requester or anyone with skin in
  // the draft (author/contributor) can pull it back, provided they have
  // draft-manage permission. Unrelated draft managers shouldn't be able to
  // retract someone else's review request. (The backend only enforces
  // canManageFeatureDrafts, so this is deliberately the stricter gate.)
  const recallableStatuses = [
    "pending-review",
    "changes-requested",
    "approved",
  ];
  const canRecallReview =
    canManageDraft &&
    (isReviewRequester || isContributor) &&
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
      // On the checklist step (submitAction "publish") soft-only blockers can
      // be acknowledged if publishing is otherwise allowed.
      canPublishAnyway: !hasNextStep && softChecklistOnly && baseEnabled,
      publishAnywayLabel,
    };
  }

  // ── Review path (approvals required) ──
  const hasNextStep =
    mergeSuccess && approved && hasSelectedExperiments && !experimentsStep;

  let ctaLabel = "Request Review";
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

  // Only "pending-review" waits on someone else; "changes-requested" hands
  // the ball back to the author, who has edit actions elsewhere on the page.
  // (hasNextStep requires approved, so !approved already excludes it.)
  const waitingForReview = status === "pending-review" && !approved;

  const baseEnabled =
    (!publishLocked || adminPublish) &&
    !(approved && !governanceCanPublish && !adminPublish) &&
    // Publishing is the only action a conflict blocks — request-review
    // remains enabled so the review cycle can start regardless.
    (mergeSuccess || submitAction === "request-review");

  const ctaEnabled = checklistGateOpen && baseEnabled;

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
    // Only the publish action is checklist-gated; request-review/none are not.
    canPublishAnyway:
      submitAction === "publish" && softChecklistOnly && baseEnabled,
    publishAnywayLabel,
  };
}
