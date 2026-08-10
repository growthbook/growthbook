import {
  getConstantRestoreChange,
  getConstantRevisionChange,
  hasUnappliablePatchOps,
} from "../src/revisions/helpers";

/** Unreadable legacy patch operations must produce conservative scopes. */

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
    expect(hasUnappliablePatchOps({ value: "x" })).toBe(false);
  });
});

describe("approval scope fails closed on an op it cannot read", () => {
  const snapshot = { value: "v", environmentValues: { production: "old" } };

  it("reports a base-value change for a nested op", () => {
    // Unreadable operations must require review rather than appear unchanged.
    const change = getConstantRevisionChange(snapshot, nested);
    expect(change.valueChanged).toBe(true);
  });

  it("still reports an unchanged revision as unchanged", () => {
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
    // Callers widen because shared code lacks the organization's environment list.
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
