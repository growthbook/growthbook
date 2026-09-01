import type { JsonPatchOperation } from "shared/enterprise";
import { applyPatchToSnapshot } from "back-end/src/revisions/util";

describe("applyPatchToSnapshot", () => {
  it("returns the original snapshot reference when there are no ops", () => {
    const snapshot = { id: "sg-1", values: ["a"] };
    expect(applyPatchToSnapshot(snapshot, [])).toBe(snapshot);
  });

  it("applies replace ops without mutating the original snapshot", () => {
    const snapshot = { id: "sg-1", values: ["a", "b"] };
    const ops: JsonPatchOperation[] = [
      { op: "replace", path: "/values", value: ["a", "b", "c"] },
    ];

    const result = applyPatchToSnapshot(snapshot, ops);

    expect(result.values).toEqual(["a", "b", "c"]);
    // original is untouched
    expect(snapshot.values).toEqual(["a", "b"]);
    expect(result).not.toBe(snapshot);
  });

  // Regression: fast-json-patch's deepClone (JSON-based) silently turned Date
  // fields into ISO strings, which broke downstream serializers calling
  // `.toISOString()`. structuredClone + in-place patch must preserve Dates.
  it("preserves Date instances on fields the patch does not touch", () => {
    const dateCreated = new Date("2024-01-02T03:04:05.000Z");
    const dateUpdated = new Date("2024-02-03T04:05:06.000Z");
    const snapshot = {
      id: "sg-1",
      dateCreated,
      dateUpdated,
      values: ["a"],
    };
    const ops: JsonPatchOperation[] = [
      { op: "replace", path: "/values", value: ["a", "b"] },
    ];

    const result = applyPatchToSnapshot(snapshot, ops);

    expect(result.dateCreated).toBeInstanceOf(Date);
    expect(result.dateUpdated).toBeInstanceOf(Date);
    expect(result.dateCreated.toISOString()).toBe(dateCreated.toISOString());
    expect(result.values).toEqual(["a", "b"]);
  });

  it("supports add and remove ops", () => {
    const snapshot: Record<string, unknown> = { id: "sg-1", keep: 1, drop: 2 };
    const ops: JsonPatchOperation[] = [
      { op: "add", path: "/added", value: "x" },
      { op: "remove", path: "/drop" },
    ];

    const result = applyPatchToSnapshot(snapshot, ops);

    expect(result.added).toBe("x");
    expect(result.drop).toBeUndefined();
    expect(result.keep).toBe(1);
  });
});
