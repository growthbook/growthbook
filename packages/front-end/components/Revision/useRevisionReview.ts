import { useCallback, useEffect, useState } from "react";
import { Revision } from "shared/enterprise";
import { useAuth } from "@/services/auth";

export type ReviewDecision = "approve" | "request-changes" | "comment";

/**
 * User-facing messages explaining why a review action is disabled.
 * Exported so callers can show them in tooltips / disabled-reason text
 * alongside the radio options.
 */
export const reviewMessages = {
  approveOwnChanges: "You cannot approve your own proposed changes.",
  requestOwnChanges: "You cannot request changes on your own proposed changes.",
  blockedContributorApprove:
    "You contributed to this revision and cannot approve it. A separate reviewer is required.",
};

interface UseRevisionReviewArgs {
  revision: Revision;
  isRevisionAuthor: boolean;
  isBlockedContributor: boolean;
  setCurrentRevision: (revision: Revision | null) => void;
  mutate?: () => void;
  closeModal?: () => void;
}

/**
 * Encapsulates the review-submission UI state and API calls for a revision:
 * - submitting a draft for review (`POST /revision/:id/submit`)
 * - posting a review decision + comment (`POST /revision/:id/review`)
 *
 * Also enforces the client-side rules that prevent authors and blocked
 * contributors from approving their own revision (the backend re-checks).
 *
 * `isSubmitting` is exposed (with its setter) so the parent can also flip it
 * during long-running actions like merge, keeping all action buttons disabled
 * together.
 */
export function useRevisionReview({
  revision,
  isRevisionAuthor,
  isBlockedContributor,
  setCurrentRevision,
  mutate,
  closeModal,
}: UseRevisionReviewArgs) {
  const { apiCall } = useAuth();

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewComment, setReviewComment] = useState("");
  const [reviewDecision, setReviewDecision] =
    useState<ReviewDecision>("comment");
  const [reviewDropdownOpen, setReviewDropdownOpen] = useState(false);

  // Force the decision back to "comment" when the user can't make this
  // decision. Avoids a stale "approve" selection if the user toggles between
  // revisions where their author/contributor status differs.
  useEffect(() => {
    if (
      (isRevisionAuthor || isBlockedContributor) &&
      reviewDecision === "approve"
    ) {
      setReviewDecision("comment");
    } else if (isRevisionAuthor && reviewDecision !== "comment") {
      setReviewDecision("comment");
    }
  }, [isRevisionAuthor, isBlockedContributor, reviewDecision]);

  const submitForReview = useCallback(async () => {
    setIsSubmitting(true);
    setReviewError(null);
    try {
      const response = await apiCall<{ revision: Revision }>(
        `/revision/${revision.id}/submit`,
        {
          method: "POST",
        },
      );

      if (response.revision) {
        setCurrentRevision(response.revision);
      }
      mutate?.();
      closeModal?.();
    } catch (error) {
      setReviewError(
        error instanceof Error ? error.message : "Failed to submit for review",
      );
    } finally {
      setIsSubmitting(false);
    }
  }, [apiCall, revision.id, setCurrentRevision, mutate, closeModal]);

  const submitReview = useCallback(
    async (decision: ReviewDecision, commentText: string) => {
      if (isRevisionAuthor && decision !== "comment") {
        setReviewError(
          decision === "approve"
            ? reviewMessages.approveOwnChanges
            : reviewMessages.requestOwnChanges,
        );
        return;
      }
      if (decision === "approve" && isBlockedContributor) {
        setReviewError(reviewMessages.blockedContributorApprove);
        return;
      }

      setIsSubmitting(true);
      setReviewError(null);
      try {
        const response = await apiCall<{ revision: Revision }>(
          `/revision/${revision.id}/review`,
          {
            method: "POST",
            body: JSON.stringify({
              decision,
              comment: commentText,
            }),
          },
        );

        if (response.revision) {
          setCurrentRevision(response.revision);
        }

        mutate?.();

        setReviewComment("");
        setReviewDecision("comment");
        setReviewDropdownOpen(false);
      } catch (error) {
        setReviewError(
          error instanceof Error ? error.message : "Failed to submit review",
        );
      } finally {
        setIsSubmitting(false);
      }
    },
    [
      apiCall,
      revision.id,
      setCurrentRevision,
      mutate,
      isRevisionAuthor,
      isBlockedContributor,
    ],
  );

  return {
    isSubmitting,
    setIsSubmitting,
    reviewError,
    setReviewError,
    reviewComment,
    setReviewComment,
    reviewDecision,
    setReviewDecision,
    reviewDropdownOpen,
    setReviewDropdownOpen,
    submitForReview,
    submitReview,
  };
}
