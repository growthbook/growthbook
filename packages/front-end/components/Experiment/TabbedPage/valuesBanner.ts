import type {
  ExperimentInterfaceStringDates,
  LinkedFeaturePendingDraft,
} from "shared/types/experiment";
import type { EventUser } from "shared/types/events/event-types";
import { isInReviewCycle } from "shared/enterprise";
import { draftApprovalSatisfied } from "@/components/Reviews/reviewAndPublishState";

type BannerDraft = Pick<
  LinkedFeaturePendingDraft,
  | "status"
  | "pendingApproval"
  | "approval"
  | "hasMergeConflict"
  | "rebaseRequired"
  | "staleApproval"
>;

/**
 * Whether the Values flag's draft has a review to open: once it's been sent
 * for one, or while it's stuck on live. Before it's sent, or where no review
 * is required, Setup's own banner is its next step.
 */
export function hasValuesReview(draft: BannerDraft): boolean {
  if (draft.hasMergeConflict || draft.rebaseRequired) return true;
  return draft.pendingApproval && isInReviewCycle(draft.status);
}

// Who acted on the review, and how long ago, formatted.
export type ReviewEvent = { user: EventUser | null; ago: string };

export type ValuesBanner = {
  status: "info" | "warning" | "success" | "error";
  title: string;
  // A byline, or the next step when nobody has acted yet.
  detail: ReviewEvent | string | null;
  cta: "Review changes" | "View request";
};

/**
 * The header banner for the Values flag's unpublished draft: what state its
 * review is in, from where this viewer stands.
 */
export function getValuesBanner({
  experimentStatus,
  draft,
  changeCount,
  canReview,
  viewerRequested,
  requested,
  verdict,
}: {
  experimentStatus: ExperimentInterfaceStringDates["status"];
  draft: BannerDraft;
  changeCount: number;
  canReview: boolean;
  viewerRequested: boolean;
  // The latest review request, and the latest approval or change request.
  requested: ReviewEvent | null;
  verdict: ReviewEvent | null;
}): ValuesBanner | null {
  if (!hasValuesReview(draft)) return null;
  const launches = experimentStatus === "draft";
  if (draft.hasMergeConflict) {
    return {
      status: "error",
      title: "Unpublished variation values have a merge conflict",
      detail:
        "Discard them from the review, or convert the Feature Flag to unmanaged and resolve it on its page.",
      cta: "Review changes",
    };
  }
  if (draft.rebaseRequired) {
    return {
      status: "warning",
      title: draft.staleApproval
        ? "The Feature Flag changed after these values were approved"
        : "The Feature Flag changed since these values were drafted",
      detail: draft.staleApproval
        ? "Update them from live and get re-approval."
        : "Update them from live before publishing.",
      cta: "Review changes",
    };
  }
  if (draft.status === "pending-review") {
    if (viewerRequested) {
      return {
        status: "info",
        title: "Your change request is awaiting review",
        detail: requested ? `Sent ${requested.ago}` : null,
        cta: "View request",
      };
    }
    const changes =
      changeCount === 1
        ? "1 change"
        : changeCount > 1
          ? `${changeCount} changes`
          : "Changes";
    return canReview
      ? {
          status: "warning",
          title: `${changes} awaiting review`,
          detail: requested,
          cta: "Review changes",
        }
      : {
          status: "info",
          title: `${changes} awaiting review`,
          detail: requested,
          cta: "View request",
        };
  }
  if (draft.status === "approved") {
    return draftApprovalSatisfied(draft)
      ? {
          status: "success",
          title: launches
            ? "Changes approved and ready to start"
            : "Changes approved and ready to publish",
          detail: verdict,
          cta: "View request",
        }
      : {
          status: "warning",
          title: "Changes approved, more approvals needed",
          detail: verdict,
          cta: "View request",
        };
  }
  // What's left of the review cycle: changes requested.
  return {
    status: "warning",
    title: "Changes requested",
    detail: verdict,
    cta: "View request",
  };
}
