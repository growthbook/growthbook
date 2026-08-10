/**
 * Monotonic identity for a review round, preventing stale verdicts from
 * applying after recall and resubmission.
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

/** Changes requested outrank approvals; callers choose the no-verdict fallback. */
export function statusFromStandingVerdicts<TFallback extends string>(
  verdicts: readonly ("approved" | "changes-requested")[],
  fallback: TFallback,
): "changes-requested" | "approved" | TFallback {
  if (verdicts.includes("changes-requested")) return "changes-requested";
  if (verdicts.includes("approved")) return "approved";
  return fallback;
}
