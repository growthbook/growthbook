// `isArmedWithAuthorizedPublisher` resolves the armer's request context, which
// reaches the database. Only that is stubbed; every rule under test stays real.
jest.mock("back-end/src/services/organizations", () => ({
  getContextForUserIdInOrg: jest.fn(),
}));

import {
  isArmedForAutoPublish,
  isArmedWithAuthorizedPublisher,
  planApproveAndPublish,
} from "back-end/src/revisions/approveAndPublish";
import { getContextForUserIdInOrg } from "back-end/src/services/organizations";

const resolveArmerContext = getContextForUserIdInOrg as jest.Mock;

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

/**
 * The armed waiver stands in for the ARMER's authority, so it must not survive
 * that authority going away. Confirming the identity still resolves was not
 * enough: a revoked role left the approval committing while the waiver hid the
 * missing authority, and the deferred publish then failed after the fact.
 */
describe("isArmedWithAuthorizedPublisher", () => {
  const armed = {
    autoPublishOnApproval: true,
    autoPublishEnabledBy: "u_armer",
  };
  const context = { org: { id: "org_armed" } } as unknown as Parameters<
    typeof isArmedWithAuthorizedPublisher
  >[0];

  beforeEach(() => {
    resolveArmerContext.mockReset();
  });

  it("is not armed when the armer no longer holds publish authority", async () => {
    resolveArmerContext.mockResolvedValue({ userId: "u_armer" });
    expect(
      await isArmedWithAuthorizedPublisher(context, armed, () => false),
    ).toBe(false);
  });

  it("is armed when the armer resolves and still holds it", async () => {
    resolveArmerContext.mockResolvedValue({ userId: "u_armer" });
    expect(
      await isArmedWithAuthorizedPublisher(context, armed, () => true),
    ).toBe(true);
  });

  it("is not armed when the armer's identity no longer resolves at all", async () => {
    resolveArmerContext.mockResolvedValue(null);
    const check = jest.fn().mockReturnValue(true);
    expect(await isArmedWithAuthorizedPublisher(context, armed, check)).toBe(
      false,
    );
    expect(check).not.toHaveBeenCalled();
  });

  it("never resolves anything for a revision that is not armed", async () => {
    const check = jest.fn().mockReturnValue(true);
    expect(
      await isArmedWithAuthorizedPublisher(
        context,
        { autoPublishOnApproval: false, autoPublishEnabledBy: "u_armer" },
        check,
      ),
    ).toBe(false);
    expect(resolveArmerContext).not.toHaveBeenCalled();
    expect(check).not.toHaveBeenCalled();
  });

  // The authority question is asked in the ARMER's context, since the deferred
  // publish runs as them — not as the approver who triggered it.
  it("evaluates authority in the armer's own context", async () => {
    resolveArmerContext.mockResolvedValue({ userId: "u_armer" });
    let sawUser: string | undefined;
    await isArmedWithAuthorizedPublisher(context, armed, (publisherContext) => {
      sawUser = (publisherContext as unknown as { userId?: string }).userId;
      return true;
    });
    expect(resolveArmerContext).toHaveBeenCalledWith(
      { id: "org_armed" },
      "u_armer",
    );
    expect(sawUser).toBe("u_armer");
  });

  it("awaits an async authority check", async () => {
    resolveArmerContext.mockResolvedValue({ userId: "u_armer" });
    expect(
      await isArmedWithAuthorizedPublisher(context, armed, async () => false),
    ).toBe(false);
  });
});
