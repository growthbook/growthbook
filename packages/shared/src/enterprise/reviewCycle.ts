/**
 * The review cycle: the identity of one round of review on a revision.
 *
 * `status` cannot serve as that identity. Recall-then-resubmit returns a revision
 * to `pending-review` — the value it already held — so a verdict, or a retraction,
 * formed against the RETRACTED round satisfies every status check and lands on the
 * new one. That is an ABA, and the consequences are not symmetric with an ordinary
 * lost update: a stale approve can approve changes nobody reviewed and fire
 * auto-publish on them, and a stale undo can drop a `changes-requested` that was
 * the only thing holding a release back.
 *
 * Both revision engines need this and both got it wrong the same way, so it lives
 * here rather than in either of them. The engines still WRITE the number
 * differently — the generic one computes it inside a CAS that guards `reviewCycle`,
 * the feature one uses `$inc` because its writes are raw — and both are monotonic,
 * which is the property that matters. What must not differ again is the question
 * they ask.
 */

/** Statuses in which a review cycle is open. */
export const REVIEW_CYCLE_STATUSES = [
  "pending-review",
  "changes-requested",
  "approved",
] as const;

/**
 * Revisions predating the field read as cycle 0, so a caller that also read 0
 * still matches and nothing legacy is locked out.
 */
export function reviewCycleOf(revision: { reviewCycle?: number }): number {
  return revision.reviewCycle ?? 0;
}

export function isSameReviewCycle(
  a: { reviewCycle?: number },
  b: { reviewCycle?: number },
): boolean {
  return reviewCycleOf(a) === reviewCycleOf(b);
}

/**
 * The refusal a caller sees when their round is gone. `what` names the action from
 * the caller's point of view ("review", "retraction") so the message says what was
 * lost rather than making them infer it.
 */
export function reviewCycleSupersededMessage(what: string): string {
  return `This review request was superseded — the draft was recalled and resubmitted while your ${what} was in flight. Reload and review the current request.`;
}
