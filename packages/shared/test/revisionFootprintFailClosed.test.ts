import {
  getConstantRestoreChange,
  getConstantRevisionChange,
  hasUnappliablePatchOps,
} from "../src/revisions/helpers";

/**
 * An op the lightweight applier can't read must widen the answer, not empty it.
 *
 * Two appliers read a revision's `proposedChanges`. The WRITE side applies the
 * patch in full; `applyTopLevelPatchOps` drops anything below the top level. When
 * authority or approval scope is derived from the second one, a dropped op reads
 * as "no value changed, no environments touched" — and both of those are spelled
 * the same way as "nothing to check here".
 *
 * The write door now rejects nested paths, so nothing NEW can store one. These
 * pin the behaviour for revisions written before that constraint, which are
 * exactly the ones no validator can retroactively fix.
 */

const nested = [
  { op: "replace" as const, path: "/environmentValues/production", value: "x" },
];
const topLevel = [
  { op: "replace" as const, path: "/environmentValues", value: { dev: "x" } },
];

describe("hasUnappliablePatchOps", () => {
  it("flags a nested path and passes a top-level one", () => {
    expect(hasUnappliablePatchOps(nested)).toBe(true);
    expect(hasUnappliablePatchOps(topLevel)).toBe(false);
    expect(hasUnappliablePatchOps([])).toBe(false);
    // Old-format revisions stored a plain object rather than an op array.
    expect(hasUnappliablePatchOps({ value: "x" })).toBe(false);
  });
});

describe("approval scope fails closed on an op it cannot read", () => {
  const snapshot = { value: "v", environmentValues: { production: "old" } };

  it("reports a base-value change for a nested op", () => {
    // `valueChanged` is what `constantRequiresReview` reads as "affects every
    // environment → always review". Without this the nested op produced
    // valueChanged:false + changedEnvironments:[], which that function's final
    // branch returns `false` for — no review required for a change that lands.
    const change = getConstantRevisionChange(snapshot, nested);
    expect(change.valueChanged).toBe(true);
  });

  it("still reports an unchanged revision as unchanged", () => {
    // The control. Widening unconditionally would pass the case above while
    // forcing review on every no-op revision.
    const change = getConstantRevisionChange(snapshot, []);
    expect(change.valueChanged).toBe(false);
    expect(change.changedEnvironments).toEqual([]);
  });

  it("still narrows to the named environment for a readable op", () => {
    const change = getConstantRevisionChange(snapshot, [
      {
        op: "replace" as const,
        path: "/environmentValues",
        value: { production: "new" },
      },
    ]);
    expect(change.valueChanged).toBe(false);
    expect(change.changedEnvironments).toEqual(["production"]);
  });
});

describe("revert footprint reports when it could not enumerate", () => {
  const live = { environmentValues: { production: "live" }, project: "" };

  it("sets unresolvedOps for a nested op", () => {
    // The endpoint and the front-end control both widen to the full serve
    // footprint on this flag. Reported rather than resolved here because the
    // widening needs the org's environment list, which shared code has no access
    // to — the caller owns that half.
    const restore = getConstantRestoreChange(live, {
      snapshot: { environmentValues: { production: "old" } },
      proposedChanges: nested,
    });
    expect(restore.unresolvedOps).toBe(true);
  });

  it("leaves it false for a readable op, and still names the environments", () => {
    const restore = getConstantRestoreChange(live, {
      snapshot: { environmentValues: {} },
      proposedChanges: topLevel,
    });
    expect(restore.unresolvedOps).toBe(false);
    expect(restore.changedEnvironments.sort()).toEqual(["dev", "production"]);
  });
});
