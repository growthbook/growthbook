import { describe, it, expect } from "vitest";
import {
  getReviewAndPublishState,
  RnPStateInput,
} from "@/components/Reviews/reviewAndPublishState";

function base(overrides: Partial<RnPStateInput> = {}): RnPStateInput {
  return {
    requireReviews: false,
    status: "draft",
    mergeSuccess: true,
    hasChanges: true,
    hasReviewPermission: false,
    canManageDraft: false,
    isReviewRequester: false,
    isContributor: false,
    isReviewer: false,
    adminPublish: false,
    hasSelectedExperiments: false,
    onlyScheduledSelected: false,
    experimentsStep: false,
    featureLockedByRamp: false,
    featureLockedBySchedule: false,
    checklistBlocked: false,
    governanceCanPublish: true,
    ...overrides,
  };
}

describe("getReviewAndPublishState", () => {
  describe("conflict mode", () => {
    it("flags fix-conflicts and disables publish when the merge failed", () => {
      const s = getReviewAndPublishState(base({ mergeSuccess: false }));
      expect(s.mode).toBe("fix-conflicts");
      expect(s.submitAction).toBe("publish");
      expect(s.ctaEnabled).toBe(false);
    });

    it("still allows requesting a review while conflicted", () => {
      const s = getReviewAndPublishState(
        base({
          mergeSuccess: false,
          requireReviews: true,
          canManageDraft: true,
        }),
      );
      expect(s.mode).toBe("fix-conflicts");
      expect(s.submitAction).toBe("request-review");
      expect(s.ctaLabel).toBe("Request Review");
      expect(s.ctaEnabled).toBe(true);
    });

    it("blocks publishing an approved draft while conflicted", () => {
      const s = getReviewAndPublishState(
        base({
          mergeSuccess: false,
          requireReviews: true,
          status: "approved",
        }),
      );
      expect(s.submitAction).toBe("publish");
      expect(s.ctaEnabled).toBe(false);
    });
  });

  describe("direct-publish path (approvals off)", () => {
    it("publishes a draft with changes", () => {
      const s = getReviewAndPublishState(base());
      expect(s.mode).toBe("main");
      expect(s.ctaLabel).toBe("Publish");
      expect(s.submitAction).toBe("publish");
      expect(s.ctaEnabled).toBe(true);
      expect(s.hasSubmit).toBe(true);
    });

    it("disables publish when there are no changes", () => {
      const s = getReviewAndPublishState(base({ hasChanges: false }));
      expect(s.ctaEnabled).toBe(false);
    });

    it("disables publish when governance blocks (stale draft, setting on)", () => {
      const s = getReviewAndPublishState(base({ governanceCanPublish: false }));
      expect(s.ctaEnabled).toBe(false);
      expect(s.submitAction).toBe("publish");
    });

    it("lets admins bypass a forced rebase (but not conflicts)", () => {
      const bypassed = getReviewAndPublishState(
        base({ governanceCanPublish: false, adminPublish: true }),
      );
      expect(bypassed.ctaEnabled).toBe(true);

      const conflicted = getReviewAndPublishState(
        base({
          governanceCanPublish: false,
          adminPublish: true,
          mergeSuccess: false,
        }),
      );
      expect(conflicted.mode).toBe("fix-conflicts");
      expect(conflicted.ctaEnabled).toBe(false);
    });

    it("advances to the experiments step when experiments are selected", () => {
      const s = getReviewAndPublishState(
        base({ hasSelectedExperiments: true }),
      );
      expect(s.ctaLabel).toBe("Next");
      expect(s.submitAction).toBe("next-experiments");
    });

    it("publishes from within the experiments step", () => {
      const s = getReviewAndPublishState(
        base({ hasSelectedExperiments: true, experimentsStep: true }),
      );
      expect(s.ctaLabel).toBe("Publish");
      expect(s.submitAction).toBe("publish");
    });

    it("uses 'Schedule to Start' when only scheduled experiments are selected", () => {
      const s = getReviewAndPublishState(
        base({
          hasSelectedExperiments: true,
          experimentsStep: true,
          onlyScheduledSelected: true,
        }),
      );
      expect(s.ctaLabel).toBe("Schedule to Start");
    });

    it("requires admin bypass to publish through a ramp lockdown", () => {
      const locked = getReviewAndPublishState(
        base({ featureLockedByRamp: true }),
      );
      expect(locked.ctaEnabled).toBe(false);
      expect(locked.ctaLocked).toBe(true);

      const bypassed = getReviewAndPublishState(
        base({ featureLockedByRamp: true, adminPublish: true }),
      );
      expect(bypassed.ctaEnabled).toBe(true);
    });

    it("locks publish when a sibling draft's scheduled publish locks others", () => {
      const locked = getReviewAndPublishState(
        base({ featureLockedBySchedule: true }),
      );
      expect(locked.ctaEnabled).toBe(false);
      expect(locked.ctaLocked).toBe(true);

      const bypassed = getReviewAndPublishState(
        base({ featureLockedBySchedule: true, adminPublish: true }),
      );
      expect(bypassed.ctaEnabled).toBe(true);
    });
  });

  describe("review path (approvals on)", () => {
    it("requests review for a fresh draft", () => {
      const s = getReviewAndPublishState(
        base({ requireReviews: true, status: "draft" }),
      );
      expect(s.ctaLabel).toBe("Request Review");
      expect(s.submitAction).toBe("request-review");
      expect(s.hasSubmit).toBe(true);
    });

    it("is read-only for a non-reviewer viewing a pending draft", () => {
      const s = getReviewAndPublishState(
        base({
          requireReviews: true,
          status: "pending-review",
          hasReviewPermission: false,
        }),
      );
      expect(s.hasSubmit).toBe(false);
      expect(s.submitAction).toBe("none");
    });

    it("reviewer in pending-review has no step CTA (uses popover instead)", () => {
      const s = getReviewAndPublishState(
        base({
          requireReviews: true,
          status: "pending-review",
          hasReviewPermission: true,
        }),
      );
      // Review submission now handled by ReviewCommentPopover, not the state machine CTA.
      expect(s.submitAction).toBe("none");
      expect(s.hasSubmit).toBe(false);
    });

    it("publishes an approved draft", () => {
      const s = getReviewAndPublishState(
        base({ requireReviews: true, status: "approved" }),
      );
      expect(s.ctaLabel).toBe("Publish");
      expect(s.submitAction).toBe("publish");
      expect(s.ctaEnabled).toBe(true);
    });

    it("blocks publishing an approved-but-stale draft (governance), unless admin bypass", () => {
      const blocked = getReviewAndPublishState(
        base({
          requireReviews: true,
          status: "approved",
          governanceCanPublish: false,
        }),
      );
      expect(blocked.ctaEnabled).toBe(false);

      const bypassed = getReviewAndPublishState(
        base({
          requireReviews: true,
          status: "approved",
          governanceCanPublish: false,
          adminPublish: true,
        }),
      );
      expect(bypassed.ctaEnabled).toBe(true);
    });

    it("approved + experiments selected: Next then publish", () => {
      const next = getReviewAndPublishState(
        base({
          requireReviews: true,
          status: "approved",
          hasSelectedExperiments: true,
        }),
      );
      expect(next.ctaLabel).toBe("Next");
      expect(next.submitAction).toBe("next-experiments");
    });

    it("blocks the CTA when a checklist is incomplete in the experiments step", () => {
      const s = getReviewAndPublishState(
        base({
          requireReviews: true,
          status: "approved",
          hasSelectedExperiments: true,
          experimentsStep: true,
          checklistBlocked: true,
        }),
      );
      expect(s.ctaEnabled).toBe(false);
    });
  });

  describe("return to draft (recall review)", () => {
    const pending = { requireReviews: true, status: "pending-review" } as const;

    it("allows the review requester", () => {
      const s = getReviewAndPublishState(
        base({ ...pending, canManageDraft: true, isReviewRequester: true }),
      );
      expect(s.canRecallReview).toBe(true);
    });

    it("allows an author/contributor who didn't request the review", () => {
      const s = getReviewAndPublishState(
        base({ ...pending, canManageDraft: true, isContributor: true }),
      );
      expect(s.canRecallReview).toBe(true);
    });

    it("blocks an unrelated draft manager", () => {
      const s = getReviewAndPublishState(
        base({ ...pending, canManageDraft: true }),
      );
      expect(s.canRecallReview).toBe(false);
    });

    it("blocks a contributor without draft-manage permission", () => {
      const s = getReviewAndPublishState(
        base({ ...pending, isContributor: true }),
      );
      expect(s.canRecallReview).toBe(false);
    });

    it("is unavailable once the revision is back in plain draft", () => {
      const s = getReviewAndPublishState(
        base({
          requireReviews: true,
          status: "draft",
          canManageDraft: true,
          isContributor: true,
          isReviewRequester: true,
        }),
      );
      expect(s.canRecallReview).toBe(false);
    });
  });
});

describe("waitingForReview", () => {
  it("is set for a pending review with no primary action", () => {
    const s = getReviewAndPublishState(
      base({ requireReviews: true, status: "pending-review" }),
    );
    expect(s.submitAction).toBe("none");
    expect(s.waitingForReview).toBe(true);
  });

  it("is not set once the draft is approved", () => {
    const s = getReviewAndPublishState(
      base({ requireReviews: true, status: "approved" }),
    );
    expect(s.waitingForReview).toBe(false);
  });

  it("is not set for changes-requested (the author holds the ball)", () => {
    const s = getReviewAndPublishState(
      base({ requireReviews: true, status: "changes-requested" }),
    );
    expect(s.waitingForReview).toBe(false);
  });

  it("is not set when an admin bypass makes the draft publishable", () => {
    const s = getReviewAndPublishState(
      base({
        requireReviews: true,
        status: "pending-review",
        adminPublish: true,
      }),
    );
    expect(s.submitAction).toBe("publish");
    expect(s.waitingForReview).toBe(false);
  });

  it("is never set on the direct-publish path", () => {
    const s = getReviewAndPublishState(base({ status: "pending-review" }));
    expect(s.waitingForReview).toBe(false);
  });
});
