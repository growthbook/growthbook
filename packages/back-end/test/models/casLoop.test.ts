import { buildCasGuard, runCasLoop } from "back-end/src/models/casLoop";

/**
 * The shared loop, tested directly.
 *
 * Both callers collapse `not-found` into their abort answer, so nothing reachable
 * from a boundary can see that outcome — mutating `not-found` to `aborted` inside the
 * loop left every other CAS suite green. Same for the ordering of read/compute/write
 * within an attempt. These pin the loop's own contract, which is the point of having
 * extracted it.
 */

const guardOf = (calls: Record<string, unknown>[]) => calls[calls.length - 1];

describe("buildCasGuard", () => {
  it("guards a present field on its value", () => {
    expect(buildCasGuard(["status"], { status: "draft" })).toEqual({
      status: "draft",
    });
  });

  // The spelling that is not interchangeable: the raw driver runs with
  // `ignoreUndefined`, so `{status: undefined}` is stripped and the write goes
  // through unconditionally.
  it("guards an ABSENT field on its absence, not on undefined", () => {
    expect(buildCasGuard(["reviews"], {})).toEqual({
      reviews: { $exists: false },
    });
  });

  it("describes every guard field, mixing present and absent", () => {
    expect(
      buildCasGuard(["status", "reviews"], { status: "approved" }),
    ).toEqual({ status: "approved", reviews: { $exists: false } });
  });
});

describe("runCasLoop", () => {
  it("reports a missing document as not-found, distinctly from an abort", async () => {
    const compute = jest.fn();
    await expect(
      runCasLoop({
        alsoGuard: ["status"],
        read: async () => null,
        compute,
        write: async () => ({ applied: true as const, result: 1 }),
      }),
    ).resolves.toEqual({ status: "not-found" });
    expect(compute).not.toHaveBeenCalled();
  });

  it("reports a refusing compute as aborted, and writes nothing", async () => {
    const write = jest.fn();
    await expect(
      runCasLoop({
        alsoGuard: ["status"],
        read: async () => ({ snapshot: { status: "draft" }, observed: {} }),
        compute: () => null,
        write,
      }),
    ).resolves.toEqual({ status: "aborted" });
    expect(write).not.toHaveBeenCalled();
  });

  it("reports exhaustion when the guard never converges", async () => {
    const write = jest.fn().mockResolvedValue({ applied: false });
    await expect(
      runCasLoop({
        alsoGuard: ["status"],
        maxAttempts: 3,
        read: async () => ({ snapshot: { status: "draft" }, observed: {} }),
        compute: () => ({ $set: {} }),
        write,
      }),
    ).resolves.toEqual({ status: "exhausted" });
    expect(write).toHaveBeenCalledTimes(3);
  });

  it("returns the write's result on success", async () => {
    await expect(
      runCasLoop({
        alsoGuard: ["status"],
        read: async () => ({ snapshot: { status: "draft" }, observed: {} }),
        compute: () => ({ $set: {} }),
        write: async () => ({ applied: true as const, result: "written" }),
      }),
    ).resolves.toEqual({ status: "applied", result: "written" });
  });

  // The classic extraction bug: a retry that re-guards on the snapshot which already
  // lost can never converge, and nothing observable says so — the write just stops
  // happening until attempts run out.
  it("re-reads on every attempt and guards on the LATEST read", async () => {
    const versions = [{ v: 1 }, { v: 2 }, { v: 3 }];
    let reads = 0;
    const guards: Record<string, unknown>[] = [];
    const outcome = await runCasLoop({
      alsoGuard: ["v"],
      read: async () => {
        const observed = versions[Math.min(reads, versions.length - 1)];
        reads++;
        return { snapshot: observed, observed };
      },
      compute: () => ({ $set: {} }),
      write: async (_u, guard) => {
        guards.push(guard);
        // Only the third read's value wins, so convergence requires fresh reads.
        return guards.length === 3
          ? { applied: true as const, result: "ok" }
          : { applied: false as const };
      },
    });
    expect(outcome).toEqual({ status: "applied", result: "ok" });
    expect(reads).toBe(3);
    expect(guards).toEqual([{ v: 1 }, { v: 2 }, { v: 3 }]);
    expect(guardOf(guards)).toEqual({ v: 3 });
  });

  // `observed` is the stored document; `snapshot` is what compute sees. A read-time
  // migration can make them differ, and the guard has to describe what is stored.
  it("guards on `observed`, not on the computed snapshot", async () => {
    const guards: Record<string, unknown>[] = [];
    await runCasLoop({
      alsoGuard: ["status"],
      read: async () => ({
        snapshot: { status: "migrated" },
        observed: { status: "stored" },
      }),
      compute: () => ({ $set: {} }),
      write: async (_u, guard) => {
        guards.push(guard);
        return { applied: true as const, result: null };
      },
    });
    expect(guards).toEqual([{ status: "stored" }]);
  });
});
