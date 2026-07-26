import {
  isArmedForAutoPublish,
  planApproveAndPublish,
} from "back-end/src/revisions/approveAndPublish";

describe("isArmedForAutoPublish", () => {
  it("is armed when auto-publish is on and an armer is recorded", () => {
    expect(
      isArmedForAutoPublish({
        autoPublishOnApproval: true,
        autoPublishEnabledBy: "u_1",
      }),
    ).toBe(true);
  });

  // The fire path falls back to the author for revisions armed before
  // `autoPublishEnabledBy` existed, so the author is a valid armer identity.
  it("falls back to the author when no explicit armer was recorded", () => {
    expect(
      isArmedForAutoPublish({ autoPublishOnApproval: true, authorId: "u_2" }),
    ).toBe(true);
  });

  it("is not armed without the flag", () => {
    expect(isArmedForAutoPublish({ autoPublishEnabledBy: "u_1" })).toBe(false);
    expect(isArmedForAutoPublish({})).toBe(false);
  });

  // Nobody's authority to run the publish under.
  it("is not armed when the flag is set but no identity resolves", () => {
    expect(isArmedForAutoPublish({ autoPublishOnApproval: true })).toBe(false);
  });
});

describe("planApproveAndPublish", () => {
  it("denies anyone without review authority", () => {
    expect(
      planApproveAndPublish({
        armed: true,
        canReview: false,
        canPublish: true,
      }),
    ).toEqual({ allowed: false });
    expect(
      planApproveAndPublish({
        armed: false,
        canReview: false,
        canPublish: true,
      }),
    ).toEqual({ allowed: false });
  });

  it("publishes inline for a reviewer who also holds publish", () => {
    expect(
      planApproveAndPublish({
        armed: false,
        canReview: true,
        canPublish: true,
      }),
    ).toEqual({ allowed: true, publishInline: true });
  });

  // The publish was authorized by whoever armed it; this approver is only the
  // trigger. Denying them would be theatre — plain Approve fires the same
  // publish through maybeAutoPublishRevision.
  it("lets a review-only approver trigger an armed revision", () => {
    expect(
      planApproveAndPublish({
        armed: true,
        canReview: true,
        canPublish: false,
      }),
    ).toEqual({ allowed: true, publishInline: false });
  });

  // Publishing inline would run as the approver and fail downstream.
  it("does not publish inline when the approver lacks publish authority", () => {
    const plan = planApproveAndPublish({
      armed: true,
      canReview: true,
      canPublish: false,
    });
    expect(plan).toEqual({ allowed: true, publishInline: false });
  });

  it("denies a review-only approver when nothing is armed", () => {
    expect(
      planApproveAndPublish({
        armed: false,
        canReview: true,
        canPublish: false,
      }),
    ).toEqual({ allowed: false });
  });

  // Arming never widens what a publisher could already do.
  it("keeps the inline path for a publisher on an armed revision", () => {
    expect(
      planApproveAndPublish({ armed: true, canReview: true, canPublish: true }),
    ).toEqual({ allowed: true, publishInline: true });
  });
});
