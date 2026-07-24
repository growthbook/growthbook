import { proposedChangesOnlyRestore } from "back-end/src/revisions/revertPurity";

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
