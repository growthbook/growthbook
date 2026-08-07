import { applyRampCreateActionsForRevision } from "back-end/src/models/FeatureModel";

/**
 * A ramp schedule the cleanup could not delete has to escape the throw.
 *
 * `create` actions run BEFORE the feature write, so a mid-loop failure leaves
 * schedules already created. The catch deletes them best-effort and rethrows —
 * but it DISCARDED the ids the delete failed on, and the rethrow unwinds past the
 * caller's `desired.createdRampScheduleIds = await …` assignment, so those ids
 * existed nowhere by the time compensation ran.
 *
 * The consequence is not a lost log line: a `pending` ramp schedule left armed
 * activates if that revision is ever published again, while the item reported a
 * clean rollback. Compensation can retry the delete and, failing that, name it —
 * but only if it is told.
 *
 * Driven through the real function with a models stub, so the callback contract is
 * exercised rather than described.
 */

describe("applyRampCreateActionsForRevision surfaces schedules it could not clean up", () => {
  const revision = {
    version: 3,
    rampActions: [
      { mode: "create", ruleId: "r1", environment: "production", steps: [] },
      { mode: "create", ruleId: "r2", environment: "production", steps: [] },
    ],
  } as never;

  // The rules the actions target must exist, or the loop skips them and the
  // create is never reached — which is how the first draft of this test passed
  // while asserting nothing.
  const feature = {
    id: "feat_1",
    organization: "org",
    // A FLAT rule list (the unified shape), and each action's rule must be in it.
    // The first draft of this test used the env-keyed shape and nested rules, and
    // the loop skipped every action — so both cases "passed" having created
    // nothing, which is the vacuous green a control case is supposed to catch and
    // in this file only the FIRST case did.
    rules: [
      { id: "r1", type: "rollout", enabled: true, environment: "production" },
      { id: "r2", type: "rollout", enabled: true, environment: "production" },
    ],
  } as never;

  const makeContext = (deleteWorks: boolean) =>
    ({
      org: { id: "org" },
      hasPremiumFeature: () => true,
      throwPlanDoesNotAllowError: () => {
        throw new Error("plan");
      },
      models: {
        rampSchedules: {
          findByTargetRule: jest.fn().mockResolvedValue([]),
          // The create loop fails on the SECOND action, after the first has
          // already created a schedule — the mid-loop throw the catch exists for.
          create: jest
            .fn()
            .mockResolvedValueOnce({ id: "ramp_1" })
            .mockRejectedValueOnce(new Error("ramp create failed")),
          dangerousDeleteByIdBypassPermission: jest.fn(async () => {
            if (!deleteWorks) throw new Error("delete failed");
          }),
        },
      },
    }) as never;

  it("hands the undeletable ids to its caller before rethrowing", async () => {
    const leaked: string[][] = [];
    await expect(
      applyRampCreateActionsForRevision(
        makeContext(false),
        feature,
        revision,
        {} as never,
        (ids) => leaked.push(ids),
      ),
    ).rejects.toThrow();

    // The original error still gates the publish — and the leak is now visible.
    expect(leaked.flat()).toEqual(["ramp_1"]);
  });

  it("reports nothing when the cleanup succeeded", async () => {
    // The control: a cleanup that worked leaked nothing, and reporting an id here
    // would send compensation chasing a schedule that no longer exists — and, via
    // `reversalFailures`, would report a clean rollback as a failed one.
    const leaked: string[][] = [];
    await expect(
      applyRampCreateActionsForRevision(
        makeContext(true),
        feature,
        revision,
        {} as never,
        (ids) => leaked.push(ids),
      ),
    ).rejects.toThrow();

    expect(leaked).toEqual([]);
  });

  it("creates before it fails, so the cases above are not vacuous", async () => {
    // The guard on the two cases above: both assert on what the CLEANUP reported,
    // and both would read the same if the loop had skipped every action and
    // created nothing at all.
    const context = makeContext(true) as unknown as {
      models: { rampSchedules: { create: jest.Mock } };
    };
    await expect(
      applyRampCreateActionsForRevision(
        context as never,
        feature,
        revision,
        {} as never,
      ),
    ).rejects.toThrow(/ramp create failed/);

    expect(context.models.rampSchedules.create).toHaveBeenCalledTimes(2);
  });
});
