import { restoreOrder } from "back-end/src/revisions/bulkPublish/bulkPublish";

/**
 * The order a compensated release puts entities back in.
 *
 * Reverse-apply is right for independent items, and silently wrong when one item's
 * descendant cascade rewrote another item's entity: a Config restored while its parent
 * still declares a field is re-stripped by ancestor normalization, and the restore
 * REPORTS success because the key was still persisted. Only an assertion on order
 * catches it — which is why `[...applied].reverse()` looked correct for five rounds.
 */

type Item = Parameters<typeof restoreOrder>[0][number];

const item = (entityId: string, cascadeTo: { id: string }[] = []): Item =>
  ({
    ref: { entityType: "config", entityId },
    revision: {
      cascade: cascadeTo.map((t) => ({ before: t, written: {}, stamp: null })),
    },
  }) as unknown as Item;

const ids = (items: Item[]) => items.map((i) => i.ref.entityId);

describe("restoreOrder", () => {
  it("reverses apply order when nothing cascaded", () => {
    const applied = [item("a"), item("b"), item("c")];
    expect(ids(restoreOrder(applied))).toEqual(["c", "b", "a"]);
  });

  it("puts a cascade parent back before the item it rewrote", () => {
    // Parent applied first and cascaded onto the child. Plain reversal restores the
    // child first, while the parent still owns the field.
    const parent = item("cfg_parent", [{ id: "cfg_child" }]);
    const child = item("cfg_child");
    expect(ids(restoreOrder([parent, child]))).toEqual([
      "cfg_parent",
      "cfg_child",
    ]);
  });

  it("orders a whole chain root-first", () => {
    const root = item("cfg_root", [{ id: "cfg_mid" }, { id: "cfg_leaf" }]);
    const mid = item("cfg_mid", [{ id: "cfg_leaf" }]);
    const leaf = item("cfg_leaf");
    expect(ids(restoreOrder([root, mid, leaf]))).toEqual([
      "cfg_root",
      "cfg_mid",
      "cfg_leaf",
    ]);
  });

  it("keeps unrelated items in reverse apply order around a cascade pair", () => {
    const first = item("x");
    const parent = item("cfg_parent", [{ id: "cfg_child" }]);
    const child = item("cfg_child");
    const last = item("y");
    // `y` and `x` are independent, so they keep reverse order; the pair is hoisted
    // only as far as the constraint requires.
    expect(ids(restoreOrder([first, parent, child, last]))).toEqual([
      "y",
      "cfg_parent",
      "cfg_child",
      "x",
    ]);
  });

  it("ignores a cascade onto an entity that is not itself in the release", () => {
    const parent = item("cfg_parent", [{ id: "cfg_outsider" }]);
    const other = item("z");
    expect(ids(restoreOrder([parent, other]))).toEqual(["z", "cfg_parent"]);
  });

  it("returns every item exactly once", () => {
    const applied = [
      item("cfg_root", [{ id: "cfg_a" }, { id: "cfg_b" }]),
      item("cfg_a", [{ id: "cfg_b" }]),
      item("cfg_b"),
      item("solo"),
    ];
    const out = restoreOrder(applied);
    expect(out).toHaveLength(applied.length);
    expect(new Set(out).size).toBe(applied.length);
  });
});
