/**
 * The review cycle: the identity of one round of review on a revision.
 *
 * `status` cannot serve as that identity — recall-then-resubmit returns a revision
 * to `pending-review`, the value it already held, so a verdict or retraction formed
 * against the RETRACTED round satisfies every status check and lands on the new one.
 * A stale approve can approve changes nobody reviewed and fire auto-publish on them;
 * a stale undo can drop the `changes-requested` that was holding a release back.
 *
 * Both engines need this and both got it wrong the same way, so it lives here. They
 * still WRITE the number differently (the generic one inside a CAS that guards
 * `reviewCycle`, the feature one via `$inc` because its writes are raw); both are
 * monotonic, which is the property that matters. What must not differ again is the
 * question they ask.
 */

/** Statuses in which a review cycle is open. */
export const REVIEW_CYCLE_STATUSES = [
  "pending-review",
  "changes-requested",
  "approved",
] as const;

/** Revisions predating the field read as cycle 0, so legacy rows still match. */
export function reviewCycleOf(revision: { reviewCycle?: number }): number {
  return revision.reviewCycle ?? 0;
}

export function isSameReviewCycle(
  a: { reviewCycle?: number },
  b: { reviewCycle?: number },
): boolean {
  return reviewCycleOf(a) === reviewCycleOf(b);
}

/** `what` names the lost action from the caller's view: "review", "retraction". */
export function reviewCycleSupersededMessage(what: string): string {
  return `This review request was superseded — the draft was recalled and resubmitted while your ${what} was in flight. Reload and review the current request.`;
}

/**
 * The status implied by the verdicts standing in the current cycle.
 *
 * A request for changes OUTRANKS an approval, so one reviewer's approval cannot
 * override another's standing objection. Callers normalize their own input and
 * choose their own fallback — those differ legitimately between the engines. The
 * precedence does not.
 */
export function statusFromStandingVerdicts<TFallback extends string>(
  verdicts: readonly ("approved" | "changes-requested")[],
  fallback: TFallback,
): "changes-requested" | "approved" | TFallback {
  if (verdicts.includes("changes-requested")) return "changes-requested";
  if (verdicts.includes("approved")) return "approved";
  return fallback;
}
