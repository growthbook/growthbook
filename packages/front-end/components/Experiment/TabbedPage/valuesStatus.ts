import type { LinkedFeaturePendingDraft } from "shared/types/experiment";
import { pendingDraftApproved } from "shared/util";

type StatusDraft = Pick<
  LinkedFeaturePendingDraft,
  | "status"
  | "pendingApproval"
  | "approval"
  | "hasMergeConflict"
  | "rebaseRequired"
  | "staleApproval"
>;

/** Where the Values flag's draft stands, its trouble with live first. */
export type ValuesDraftStage =
  | "conflict"
  | "stale"
  // No review required.
  | "unreviewed"
  | "unsent"
  | "pending-review"
  | "changes-requested"
  | "short-of-approval"
  | "approved";

export function getValuesDraftStage(draft: StatusDraft): ValuesDraftStage {
  if (draft.hasMergeConflict) return "conflict";
  if (draft.rebaseRequired) return "stale";
  if (!draft.pendingApproval) return "unreviewed";
  if (draft.status === "pending-review") return "pending-review";
  if (draft.status === "changes-requested") return "changes-requested";
  if (draft.status === "approved") {
    return pendingDraftApproved(draft) ? "approved" : "short-of-approval";
  }
  return "unsent";
}

/**
 * Whether the Values flag's draft has a review to open: once it's been sent
 * for one, or while it's stuck on live.
 */
export function hasValuesReview(draft: StatusDraft): boolean {
  const stage = getValuesDraftStage(draft);
  return stage !== "unreviewed" && stage !== "unsent";
}
