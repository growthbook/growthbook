import {
  isPureRevertRevision,
  proposedChangesOnlyRestore,
} from "back-end/src/revisions/revertPurity";

// State the target revision left behind when it was published.
const TARGET = {
  value: "off",
  rules: [{ id: "r1", enabled: false }],
  description: "original",
  archived: false,
};

const op = (path: string, value: unknown) => ({
  op: "replace" as const,
  path,
  value,
});

describe("proposedChangesOnlyRestore", () => {
  it("accepts a change set that restores target values exactly", () => {
    expect(
      proposedChangesOnlyRestore(
        [op("/value", "off"), op("/rules", [{ id: "r1", enabled: false }])],
        TARGET,
      ),
    ).toBe(true);
  });

  it("accepts a subset of the target's fields", () => {
    expect(proposedChangesOnlyRestore([op("/value", "off")], TARGET)).toBe(
      true,
    );
  });

  it("rejects a change set carrying an edited value", () => {
    expect(proposedChangesOnlyRestore([op("/value", "maybe")], TARGET)).toBe(
      false,
    );
  });

  it("rejects a mixed revert plus edit", () => {
    expect(
      proposedChangesOnlyRestore(
        [op("/value", "off"), op("/description", "sneaky edit")],
        TARGET,
      ),
    ).toBe(false);
  });

  it("rejects deep-equal-looking but different structures", () => {
    expect(
      proposedChangesOnlyRestore(
        [op("/rules", [{ id: "r1", enabled: true }])],
        TARGET,
      ),
    ).toBe(false);
  });

  it("accepts restoring a falsy value", () => {
    expect(proposedChangesOnlyRestore([op("/archived", false)], TARGET)).toBe(
      true,
    );
  });

  it("rejects setting a field absent from the target", () => {
    expect(proposedChangesOnlyRestore([op("/newField", "x")], TARGET)).toBe(
      false,
    );
  });

  it("rejects an empty change set", () => {
    expect(proposedChangesOnlyRestore([], TARGET)).toBe(false);
  });

  it("rejects non-value ops", () => {
    expect(
      proposedChangesOnlyRestore([{ op: "remove", path: "/value" }], TARGET),
    ).toBe(false);
    expect(
      proposedChangesOnlyRestore(
        [{ op: "move", from: "/value", path: "/description" }],
        TARGET,
      ),
    ).toBe(false);
  });

  it("rejects nested paths rather than guessing at nested equality", () => {
    expect(
      proposedChangesOnlyRestore([op("/rules/0/enabled", false)], TARGET),
    ).toBe(false);
  });
});

/**
 * `revertedFrom` is client-supplied, so purity must be judged against a state
 * that was actually LIVE. Without the status check, draft B naming draft A as
 * its target passes purity against A's never-published values — turning
 * draft + revert authority into arbitrary publish authority.
 */
describe("isPureRevertRevision — target status", () => {
  const LIVE = { value: "off", description: "original" };

  function ctx(targetStatus: string) {
    return {
      models: {
        revisions: {
          getById: jest.fn(async () => ({
            id: "rev_target",
            status: targetStatus,
            target: {
              type: "config",
              id: "cfg1",
              snapshot: LIVE,
              proposedChanges: [],
            },
          })),
        },
      },
    } as unknown as Parameters<typeof isPureRevertRevision>[0];
  }

  const draft = {
    id: "rev_b",
    revertedFrom: "rev_target",
    target: {
      type: "config",
      id: "cfg1",
      snapshot: { value: "on", description: "original" },
      proposedChanges: [op("/value", "off")],
    },
  } as unknown as Parameters<typeof isPureRevertRevision>[1];

  it("accepts a restoration of a merged (published) revision", async () => {
    expect(await isPureRevertRevision(ctx("merged"), draft)).toBe(true);
  });

  it.each(["draft", "pending-review", "approved", "discarded"])(
    "refuses a target in %s — its values were never live",
    async (status) => {
      expect(await isPureRevertRevision(ctx(status), draft)).toBe(false);
    },
  );
});
