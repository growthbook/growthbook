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

/**
 * The status implied by the verdicts standing in the current cycle.
 *
 * One invariant, and it is the one that must never diverge: a request for changes
 * OUTRANKS an approval, so one reviewer's approval cannot override another
 * reviewer's standing objection. Encoded in four places across the two engines,
 * each with its own shape — the generic engine dedupes to the latest verdict per
 * reviewer and falls back to the row's current status when a comment leaves it
 * untouched; the feature engine's array is already one entry per reviewer and falls
 * back to `pending-review`. Those differences are real, so callers still normalize
 * their own input and choose their own fallback. The PRECEDENCE is not a difference,
 * and is no longer written four times.
 */
export function statusFromStandingVerdicts<TFallback extends string>(
  verdicts: readonly ("approved" | "changes-requested")[],
  fallback: TFallback,
): "changes-requested" | "approved" | TFallback {
  if (verdicts.includes("changes-requested")) return "changes-requested";
  if (verdicts.includes("approved")) return "approved";
  return fallback;
}
