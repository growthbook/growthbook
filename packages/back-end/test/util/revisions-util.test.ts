import type { JsonPatchOperation } from "shared/enterprise";
import {
  applyPatchToSnapshot,
  buildPatchOps,
} from "back-end/src/revisions/util";

describe("back-end revisions/util", () => {
  describe("applyPatchToSnapshot", () => {
    it("returns the snapshot unchanged when proposedChanges is empty", () => {
      const snap = { a: 1, b: "two" };
      expect(applyPatchToSnapshot(snap, [])).toBe(snap);
    });

    it("returns the snapshot unchanged for legacy plain-object input", () => {
      const snap = { a: 1 };
      // Old DB format stored a plain object; normalize treats it as empty.
      const result = applyPatchToSnapshot(snap, {
        a: 2,
      } as unknown as JsonPatchOperation[]);
      expect(result).toBe(snap);
    });

    it("applies replace ops to top-level fields", () => {
      const snap = { name: "old", count: 1 };
      const result = applyPatchToSnapshot<typeof snap>(snap, [
        { op: "replace", path: "/name", value: "new" },
      ]);
      expect(result).toEqual({ name: "new", count: 1 });
    });

    it("applies add ops to add new fields", () => {
      const snap: Record<string, unknown> = { a: 1 };
      const result = applyPatchToSnapshot(snap, [
        { op: "add", path: "/b", value: 2 },
      ]);
      expect(result).toEqual({ a: 1, b: 2 });
    });

    it("applies remove ops to delete fields", () => {
      const snap: Record<string, unknown> = { a: 1, b: 2 };
      const result = applyPatchToSnapshot(snap, [{ op: "remove", path: "/b" }]);
      expect(result).toEqual({ a: 1 });
    });

    it("applies nested array replacement via JSON Patch", () => {
      const snap = { values: ["a", "b", "c"] };
      const result = applyPatchToSnapshot<typeof snap>(snap, [
        { op: "replace", path: "/values/1", value: "B" },
      ]);
      expect(result).toEqual({ values: ["a", "B", "c"] });
    });

    it("does not mutate the original snapshot", () => {
      const snap = { values: ["a", "b"] };
      applyPatchToSnapshot<typeof snap>(snap, [
        { op: "add", path: "/values/-", value: "c" },
      ]);
      expect(snap).toEqual({ values: ["a", "b"] });
    });

    it("applies multiple ops in order", () => {
      const snap = { a: 1, b: 2 };
      const result = applyPatchToSnapshot<typeof snap>(snap, [
        { op: "replace", path: "/a", value: 10 },
        { op: "replace", path: "/b", value: 20 },
      ]);
      expect(result).toEqual({ a: 10, b: 20 });
    });
  });

  describe("buildPatchOps", () => {
    it("returns empty array for empty input", () => {
      expect(buildPatchOps({})).toEqual([]);
    });

    it("creates one replace op per defined field", () => {
      const ops = buildPatchOps({ name: "x", count: 5 });
      // Map order is preserved, but order doesn't matter for correctness.
      expect(ops).toEqual(
        expect.arrayContaining([
          { op: "replace", path: "/name", value: "x" },
          { op: "replace", path: "/count", value: 5 },
        ]),
      );
      expect(ops).toHaveLength(2);
    });

    it("filters out undefined and null values", () => {
      const ops = buildPatchOps({
        name: "x",
        desc: undefined,
        owner: null,
        archived: false, // falsy but defined → keep
      });
      expect(ops).toEqual(
        expect.arrayContaining([
          { op: "replace", path: "/name", value: "x" },
          { op: "replace", path: "/archived", value: false },
        ]),
      );
      expect(ops).toHaveLength(2);
    });

    it("preserves array, object, and zero values", () => {
      const ops = buildPatchOps({
        values: ["a"],
        meta: { x: 1 },
        zero: 0,
        empty: "",
      });
      expect(ops).toHaveLength(4);
      const byPath = new Map(ops.map((o) => [o.path, o]));
      expect(byPath.get("/values")).toEqual({
        op: "replace",
        path: "/values",
        value: ["a"],
      });
      expect(byPath.get("/meta")).toEqual({
        op: "replace",
        path: "/meta",
        value: { x: 1 },
      });
      expect(byPath.get("/zero")).toEqual({
        op: "replace",
        path: "/zero",
        value: 0,
      });
      expect(byPath.get("/empty")).toEqual({
        op: "replace",
        path: "/empty",
        value: "",
      });
    });
  });

  // Snapshot-building behavior is now exercised against the saved-group
  // adapter directly — see test/revisions/saved-group.adapter.test.ts.
});
