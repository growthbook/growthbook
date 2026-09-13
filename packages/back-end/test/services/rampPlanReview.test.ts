import type { FeatureInterface } from "shared/types/feature";
import type { RampScheduleInterface } from "shared/validators";
import {
  assertRampPlanChangeAllowed,
  assertRampScheduleReplanAllowed,
  changesRampPlan,
} from "back-end/src/services/rampPlanReview";
import { getAllFeatures } from "back-end/src/models/FeatureModel";
import { ReqContext } from "back-end/types/request";

jest.mock("back-end/src/models/FeatureModel", () => ({
  getAllFeatures: jest.fn(),
}));

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

describe("assertRampScheduleReplanAllowed", () => {
  const schedule = {
    entityId: "anchor",
    targets: [{ entityId: "anchor" }, { entityId: "other" }],
  } as unknown as Pick<RampScheduleInterface, "entityId" | "targets">;
  const ctx = (bypassOn: string[]) =>
    ({
      org: { settings: { requireReviews: true } },
      hasPremiumFeature: () => true,
      permissions: {
        canBypassFlagApprovalChecks: (f: { id: string }) =>
          bypassOn.includes(f.id),
      },
    }) as unknown as ReqContext;

  beforeEach(() => {
    jest
      .mocked(getAllFeatures)
      .mockResolvedValue([
        { id: "anchor" },
        { id: "other" },
      ] as FeatureInterface[]);
  });

  it("needs bypass authority on every targeted feature", async () => {
    await expect(
      assertRampScheduleReplanAllowed(ctx(["anchor"]), schedule),
    ).rejects.toThrow(/requires review/);
    await expect(
      assertRampScheduleReplanAllowed(ctx(["anchor", "other"]), schedule),
    ).resolves.toBeUndefined();
    expect(getAllFeatures).toHaveBeenCalledWith(expect.anything(), {
      ids: ["anchor", "other"],
      includeArchived: true,
    });
  });

  it("refuses when a targeted feature is not readable, and skips loading under the REST bypass", async () => {
    jest
      .mocked(getAllFeatures)
      .mockResolvedValue([{ id: "anchor" }] as FeatureInterface[]);
    await expect(
      assertRampScheduleReplanAllowed(ctx(["anchor", "other"]), schedule),
    ).rejects.toThrow(/"other" is not readable/);
    jest.mocked(getAllFeatures).mockClear();
    await expect(
      assertRampScheduleReplanAllowed(ctx([]), schedule, true),
    ).resolves.toBeUndefined();
    expect(getAllFeatures).not.toHaveBeenCalled();
  });
});

describe("changesRampPlan", () => {
  it("is true only for fields the scheduler applies, including clearing a date", () => {
    expect(changesRampPlan({ name: "renamed" })).toBe(false);
    expect(changesRampPlan({ lockdownConfig: { mode: "locked" } })).toBe(false);
    expect(changesRampPlan({ startDate: null })).toBe(true);
    expect(changesRampPlan({ steps: [] })).toBe(true);
    expect(changesRampPlan({ startDate: "2030-01-01T00:00:00.000Z" })).toBe(
      true,
    );
  });
});
