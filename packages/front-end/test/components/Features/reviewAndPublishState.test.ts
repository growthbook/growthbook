import { describe, it, expect } from "vitest";
import {
  getReviewAndPublishState,
  RnPStateInput,
} from "@/components/Features/reviewAndPublishState";

function base(overrides: Partial<RnPStateInput> = {}): RnPStateInput {
  return {
    requireReviews: false,
    status: "draft",
    mergeSuccess: true,
    hasChanges: true,
    canReview: false,
    canManageDraft: false,
    adminPublish: false,
    hasSelectedExperiments: false,
    onlyScheduledSelected: false,
    experimentsStep: false,
    showSubmitReview: false,
    featureLockedByRamp: false,
    checklistBlocked: false,
    governanceCanPublish: true,
    ...overrides,
  };
}

describe("getReviewAndPublishState", () => {
  describe("conflict mode", () => {
    it("routes to fix-conflicts when the merge failed", () => {
      const s = getReviewAndPublishState(base({ mergeSuccess: false }));
      expect(s.mode).toBe("fix-conflicts");
      expect(s.ctaLabel).toBe("Update Draft");
    });
  });

  describe("submit-review sub-view", () => {
    it("shows the Submit CTA", () => {
      const s = getReviewAndPublishState(
        base({
          requireReviews: true,
          status: "pending-review",
          showSubmitReview: true,
        }),
      );
      expect(s.mode).toBe("submit-review");
      expect(s.ctaLabel).toBe("Submit");
      expect(s.ctaEnabled).toBe(true);
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
          canReview: false,
        }),
      );
      expect(s.hasSubmit).toBe(false);
      expect(s.submitAction).toBe("none");
    });

    it("lets a reviewer advance to the submit-review sub-view", () => {
      const s = getReviewAndPublishState(
        base({
          requireReviews: true,
          status: "pending-review",
          canReview: true,
        }),
      );
      expect(s.ctaLabel).toBe("Next");
      expect(s.submitAction).toBe("show-submit-review");
      expect(s.hasSubmit).toBe(true);
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
});
