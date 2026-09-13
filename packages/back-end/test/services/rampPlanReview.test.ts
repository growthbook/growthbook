import type { FeatureInterface } from "shared/types/feature";
import {
  assertRampPlanChangeAllowed,
  changesRampPlan,
} from "back-end/src/services/rampPlanReview";
import { ReqContext } from "back-end/types/request";

describe("assertRampPlanChangeAllowed", () => {
  const feature = { id: "flag", project: "p1" } as FeatureInterface;
  const ctx = (opts: {
    requireReviews?: unknown;
    licensed?: boolean;
    canBypass?: boolean;
  }) =>
    ({
      org: { settings: { requireReviews: opts.requireReviews } },
      hasPremiumFeature: () => opts.licensed ?? true,
      permissions: {
        canBypassFlagApprovalChecks: () => opts.canBypass ?? false,
      },
    }) as unknown as ReqContext;

  it("is open when the org requires no review anywhere", () => {
    for (const requireReviews of [
      undefined,
      false,
      [],
      [{ requireReviewOn: false, projects: ["p1"] }],
    ]) {
      expect(() =>
        assertRampPlanChangeAllowed(ctx({ requireReviews }), feature),
      ).not.toThrow();
    }
  });

  it("is open when approvals are not licensed even if configured", () => {
    expect(() =>
      assertRampPlanChangeAllowed(
        ctx({ requireReviews: true, licensed: false }),
        feature,
      ),
    ).not.toThrow();
  });

  it("refuses once any review rule is on, regardless of the target's project", () => {
    const context = ctx({
      requireReviews: [{ requireReviewOn: true, projects: ["other"] }],
    });
    expect(() => assertRampPlanChangeAllowed(context, feature)).toThrow(
      /revisions\/\{version\}\/rules\/\{ruleId\}\/ramp-schedule/,
    );
    expect(() =>
      assertRampPlanChangeAllowed(ctx({ requireReviews: true }), feature),
    ).toThrow(/requires review/);
  });

  it("lets approval-bypass callers through, by permission or REST setting", () => {
    expect(() =>
      assertRampPlanChangeAllowed(
        ctx({ requireReviews: true, canBypass: true }),
        feature,
      ),
    ).not.toThrow();
    expect(() =>
      assertRampPlanChangeAllowed(ctx({ requireReviews: true }), feature, true),
    ).not.toThrow();
  });
});

describe("changesRampPlan", () => {
  it("is true only for fields the scheduler applies", () => {
    expect(changesRampPlan({ name: "renamed" })).toBe(false);
    expect(changesRampPlan({ lockdownConfig: { mode: "locked" } })).toBe(false);
    expect(changesRampPlan({ startDate: null })).toBe(false);
    expect(changesRampPlan({ steps: [] })).toBe(true);
    expect(changesRampPlan({ startDate: "2030-01-01T00:00:00.000Z" })).toBe(
      true,
    );
  });
});
