import { describe, expect, it } from "vitest";
import {
  isLayoutCustomized,
  mergeLayoutForWrite,
  resolveTableColumns,
  TableColumnDef,
  TableColumnLayout,
} from "@/services/tableColumns";

type Row = { id: string };

function col(
  id: string,
  extra: Partial<TableColumnDef<Row>> = {},
): TableColumnDef<Row> {
  return { id, label: id.toUpperCase(), render: () => null, ...extra };
}

const layout = (
  columns: TableColumnLayout["columns"],
  v = 1,
): TableColumnLayout => ({ v, columns });

describe("resolveTableColumns", () => {
  it("returns code defaults when there is no stored layout", () => {
    const defs = [col("a"), col("b", { defaultHidden: true })];
    const resolved = resolveTableColumns(defs, null);
    expect(resolved.map((c) => [c.id, c.visible])).toEqual([
      ["a", true],
      ["b", false],
    ]);
  });

  it("honours the stored order and visibility", () => {
    const defs = [col("a"), col("b"), col("c")];
    const resolved = resolveTableColumns(
      defs,
      layout([
        { id: "c", visible: true },
        { id: "a", visible: false },
        { id: "b", visible: true },
      ]),
    );
    expect(resolved.map((c) => c.id)).toEqual(["c", "a", "b"]);
    expect(resolved.find((c) => c.id === "a")?.visible).toBe(false);
  });

  it("drops stored ids that no longer exist in code", () => {
    const defs = [col("a"), col("b")];
    const resolved = resolveTableColumns(
      defs,
      layout([
        { id: "gone", visible: true },
        { id: "b", visible: true },
        { id: "a", visible: true },
      ]),
    );
    expect(resolved.map((c) => c.id)).toEqual(["b", "a"]);
  });

  it("splices a newly added column after its predecessor in code, not at the end", () => {
    // "owner" is added in code between b and actions; the stored layout predates it.
    const defs = [col("a"), col("b"), col("owner"), col("actions")];
    const resolved = resolveTableColumns(
      defs,
      layout([
        { id: "b", visible: true },
        { id: "a", visible: true },
        { id: "actions", visible: true },
      ]),
    );
    // Follows "b", the column it comes after in code — and crucially lands
    // before the trailing row-actions column rather than after it.
    expect(resolved.map((c) => c.id)).toEqual(["b", "owner", "a", "actions"]);
  });

  it("keeps a newly added trailing column ahead of the row-actions column", () => {
    // The shape #6702 produces: a custom-field column added just before actions.
    const defs = [col("a"), col("b"), col("custom:team"), col("actions")];
    const resolved = resolveTableColumns(
      defs,
      layout([
        { id: "a", visible: true },
        { id: "b", visible: true },
        { id: "actions", visible: true },
      ]),
    );
    expect(resolved.map((c) => c.id)).toEqual([
      "a",
      "b",
      "custom:team",
      "actions",
    ]);
  });

  it("respects defaultHidden for a newly added column", () => {
    const defs = [col("a"), col("new", { defaultHidden: true })];
    const resolved = resolveTableColumns(
      defs,
      layout([{ id: "a", visible: true }]),
    );
    expect(resolved.find((c) => c.id === "new")?.visible).toBe(false);
  });

  it("forces locked columns visible and back to their position in code", () => {
    const defs = [
      col("name", { locked: true }),
      col("b"),
      col("actions", { locked: true }),
    ];
    const resolved = resolveTableColumns(
      defs,
      layout([
        { id: "actions", visible: false },
        { id: "b", visible: true },
        { id: "name", visible: false },
      ]),
    );
    expect(resolved.map((c) => c.id)).toEqual(["name", "b", "actions"]);
    expect(resolved.every((c) => c.visible)).toBe(true);
  });

  it("cannot hide a column marked hideable: false", () => {
    const defs = [col("a", { hideable: false })];
    const resolved = resolveTableColumns(
      defs,
      layout([{ id: "a", visible: false }]),
    );
    expect(resolved[0].visible).toBe(true);
  });

  it("still honours the stored position of a hideable: false column", () => {
    // hideable: false means "always visible", not "pinned" — unlike `locked`,
    // which is what the row-actions column uses.
    const defs = [col("name", { hideable: false }), col("b"), col("c")];
    const resolved = resolveTableColumns(
      defs,
      layout([
        { id: "b", visible: true },
        { id: "name", visible: true },
        { id: "c", visible: true },
      ]),
    );
    expect(resolved.map((c) => c.id)).toEqual(["b", "name", "c"]);
    expect(resolved.every((c) => c.visible)).toBe(true);
  });

  it("clamps a stored width up to a raised minWidth", () => {
    const defs = [col("a", { minWidth: 150 })];
    const resolved = resolveTableColumns(
      defs,
      layout([{ id: "a", visible: true, width: 80 }]),
    );
    expect(resolved[0].width).toBe(150);
  });

  it("clamps a stored width down to maxWidth", () => {
    const defs = [col("a", { maxWidth: 300 })];
    const resolved = resolveTableColumns(
      defs,
      layout([{ id: "a", visible: true, width: 5000 }]),
    );
    expect(resolved[0].width).toBe(300);
  });

  it("drops non-finite and non-positive stored widths", () => {
    const defs = [col("a"), col("b")];
    const resolved = resolveTableColumns(
      defs,
      layout([
        { id: "a", visible: true, width: Number.NaN },
        { id: "b", visible: true, width: -10 },
      ]),
    );
    expect(resolved[0].width).toBeUndefined();
    expect(resolved[1].width).toBeUndefined();
  });

  it("falls back to defaults on a version mismatch", () => {
    const defs = [col("a"), col("b")];
    const resolved = resolveTableColumns(
      defs,
      layout([{ id: "b", visible: false }], 99),
    );
    expect(resolved.map((c) => [c.id, c.visible])).toEqual([
      ["a", true],
      ["b", true],
    ]);
  });

  // The stored value comes from localStorage, so it can be hand-edited or left
  // behind by a different shape of this schema. None of these may throw — the
  // page would white-screen with no way to recover from the UI.
  it.each([
    ["columns missing", { v: 1 }],
    ["columns null", { v: 1, columns: null }],
    ["columns a non-array object", { v: 1, columns: { a: true } }],
    ["columns a string", { v: 1, columns: "nope" }],
    ["a null entry", { v: 1, columns: [null, { id: "a", visible: true }] }],
    ["an entry with no id", { v: 1, columns: [{ visible: true }] }],
    ["an entry with a non-string id", { v: 1, columns: [{ id: 7 }] }],
    ["the whole value a string", "garbage"],
    ["the whole value an array", []],
  ])("survives a malformed stored layout: %s", (_label, stored) => {
    const defs = [col("a"), col("b")];
    expect(() =>
      resolveTableColumns(defs, stored as unknown as TableColumnLayout),
    ).not.toThrow();
    const resolved = resolveTableColumns(
      defs,
      stored as unknown as TableColumnLayout,
    );
    expect(resolved.map((c) => c.id)).toEqual(["a", "b"]);
    expect(resolved.every((c) => c.visible)).toBe(true);
  });

  it("keeps the usable entries when only some are malformed", () => {
    const defs = [col("a"), col("b")];
    const resolved = resolveTableColumns(defs, {
      v: 1,
      columns: [null, { id: "b", visible: false }],
    } as unknown as TableColumnLayout);
    // "a" wasn't in the layout and has no saved predecessor, so it leads.
    expect(resolved.map((c) => c.id)).toEqual(["a", "b"]);
    expect(resolved.find((c) => c.id === "b")?.visible).toBe(false);
  });

  it("falls back to defaults when no stored id is recognised", () => {
    const defs = [col("a"), col("b")];
    const resolved = resolveTableColumns(
      defs,
      layout([{ id: "gone", visible: false }]),
    );
    expect(resolved.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("ignores duplicate stored entries", () => {
    const defs = [col("a"), col("b")];
    const resolved = resolveTableColumns(
      defs,
      layout([
        { id: "a", visible: true },
        { id: "a", visible: false },
        { id: "b", visible: true },
      ]),
    );
    expect(resolved.map((c) => c.id)).toEqual(["a", "b"]);
    expect(resolved[0].visible).toBe(true);
  });
});

describe("mergeLayoutForWrite", () => {
  it("preserves stored entries for columns that no longer exist in code", () => {
    const defs = [col("a")];
    const stored = layout([
      { id: "a", visible: true },
      { id: "removed-in-this-deploy", visible: false, width: 120 },
    ]);
    const resolved = resolveTableColumns(defs, stored);
    const merged = mergeLayoutForWrite(resolved, stored);
    expect(merged.columns.map((c) => c.id)).toEqual([
      "a",
      "removed-in-this-deploy",
    ]);
  });

  it("writes the current version", () => {
    const defs = [col("a")];
    const merged = mergeLayoutForWrite(resolveTableColumns(defs, null), null);
    expect(merged.v).toBe(1);
  });

  it("ignores a malformed stored value instead of throwing", () => {
    const defs = [col("a")];
    const stored = {
      v: 1,
      columns: [null, "x"],
    } as unknown as TableColumnLayout;
    expect(() =>
      mergeLayoutForWrite(resolveTableColumns(defs, stored), stored),
    ).not.toThrow();
    expect(
      mergeLayoutForWrite(
        resolveTableColumns(defs, stored),
        stored,
      ).columns.map((c) => c.id),
    ).toEqual(["a"]);
  });

  it("does not carry orphans across a version mismatch", () => {
    const defs = [col("a")];
    const stored = layout([{ id: "old", visible: true }], 99);
    const merged = mergeLayoutForWrite(
      resolveTableColumns(defs, stored),
      stored,
    );
    expect(merged.columns.map((c) => c.id)).toEqual(["a"]);
  });
});

describe("isLayoutCustomized", () => {
  it("is false for the code defaults", () => {
    const defs = [col("a", { defaultWidth: 100 }), col("b")];
    expect(isLayoutCustomized(defs, resolveTableColumns(defs, null))).toBe(
      false,
    );
  });

  it("is true when the order differs", () => {
    const defs = [col("a"), col("b")];
    const resolved = resolveTableColumns(
      defs,
      layout([
        { id: "b", visible: true },
        { id: "a", visible: true },
      ]),
    );
    expect(isLayoutCustomized(defs, resolved)).toBe(true);
  });

  it("is true when a column is hidden", () => {
    const defs = [col("a"), col("b")];
    const resolved = resolveTableColumns(
      defs,
      layout([
        { id: "a", visible: true },
        { id: "b", visible: false },
      ]),
    );
    expect(isLayoutCustomized(defs, resolved)).toBe(true);
  });

  it("is true when a width differs from the default", () => {
    const defs = [col("a", { defaultWidth: 100 })];
    const resolved = resolveTableColumns(
      defs,
      layout([{ id: "a", visible: true, width: 240 }]),
    );
    expect(isLayoutCustomized(defs, resolved)).toBe(true);
  });
});
