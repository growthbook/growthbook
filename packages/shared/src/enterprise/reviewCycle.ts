export const REVIEW_CYCLE_STATUSES = [
  "pending-review",
  "changes-requested",
  "approved",
] as const;

// Whether a revision's status still accepts reviewer verdicts.
export function isInReviewCycle(status: string | undefined): boolean {
  return (REVIEW_CYCLE_STATUSES as readonly string[]).includes(status ?? "");
}

// Revisions predating the field read as cycle 0, so legacy rows still match.
export function reviewCycleOf(revision: { reviewCycle?: number }): number {
  return revision.reviewCycle ?? 0;
}

export function isSameReviewCycle(
  a: { reviewCycle?: number },
  b: { reviewCycle?: number },
): boolean {
  return reviewCycleOf(a) === reviewCycleOf(b);
}

export function reviewCycleSupersededMessage(
  what: "review" | "retraction",
): string {
  return `This review request was superseded — the draft was recalled and resubmitted while your ${what} was in flight. Reload and review the current request.`;
}

// Changes requested outrank approvals; callers choose the no-verdict fallback.
export function statusFromStandingVerdicts<TFallback extends string>(
  verdicts: readonly ("approved" | "changes-requested")[],
  fallback: TFallback,
): "changes-requested" | "approved" | TFallback {
  if (verdicts.includes("changes-requested")) return "changes-requested";
  if (verdicts.includes("approved")) return "approved";
  return fallback;
}
