import { describe, expect, it } from "vitest";
import {
  fitColumnWidths,
  isLayoutCustomized,
  mergeLayoutForWrite,
  minTableWidth,
  resizeColumnWidth,
  resolveTableColumns,
  TableColumnDef,
  TableColumnLayout,
  withSpacerColumn,
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

  it("ignores a stored width for a column the user cannot resize", () => {
    // The bug this guards: the row-actions column narrowed in code, but anyone
    // with a saved layout kept the old width, which they could never undo.
    const defs = [
      col("actions", { resizable: false, defaultWidth: 40, minWidth: 40 }),
    ];
    const resolved = resolveTableColumns(
      defs,
      layout([{ id: "actions", visible: true, width: 56 }]),
    );
    expect(resolved[0].width).toBe(40);
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

describe("minTableWidth", () => {
  it("sums each visible column's minimum, not its width", () => {
    const defs = [
      col("a", { defaultWidth: 300, minWidth: 100 }),
      col("b", { defaultWidth: 300 }),
      col("hidden", { minWidth: 500, defaultHidden: true }),
      col("spacer", { minWidth: 0 }),
      col("actions", { defaultWidth: 40, minWidth: 30, resizable: false }),
    ];
    // 100 + the shared 64 floor + 0 + the fixed column's own 40.
    expect(minTableWidth(resolveTableColumns(defs, null))).toBe(204);
  });
});

describe("withSpacerColumn", () => {
  it("goes ahead of trailing locked columns, or last without any", () => {
    const ids = (defs: TableColumnDef<Row>[]) =>
      withSpacerColumn(defs).map((c) => c.id);
    expect(
      ids([
        col("a", { locked: true }),
        col("b"),
        col("actions", { locked: true }),
      ]),
    ).toEqual(["a", "b", "spacer", "actions"]);
    expect(ids([col("a"), col("b")])).toEqual(["a", "b", "spacer"]);
  });
});

describe("fitColumnWidths", () => {
  const defs = [
    col("a", { defaultWidth: 300, minWidth: 100 }),
    col("b", { defaultWidth: 100, minWidth: 100 }),
    col("c", { defaultWidth: 200, minWidth: 100 }),
    col("spacer", { minWidth: 0 }),
    col("actions", { defaultWidth: 40, minWidth: 40, resizable: false }),
  ];
  const visible = resolveTableColumns(defs, null);
  const fit = (available: number) =>
    Object.fromEntries(fitColumnWidths(visible, available));

  it("keeps saved widths while they fit, leaving the slack column out", () => {
    expect(fit(1000)).toEqual({ a: 300, b: 100, c: 200, actions: 40 });
  });

  it("shrinks resizable columns in proportion, sparing ones at their minimum", () => {
    // 100 over: a and c give it up 3:2, b is already at its floor.
    expect(fit(540)).toEqual({ a: 240, b: 100, c: 160, actions: 40 });
  });

  it("passes a floored column's share on, and stops at the minimums", () => {
    // c floors at 100 first; a absorbs the rest.
    expect(fit(360)).toEqual({ a: 120, b: 100, c: 100, actions: 40 });
    expect(fit(100)).toEqual({ a: 100, b: 100, c: 100, actions: 40 });
  });
});

describe("resizeColumnWidth", () => {
  const defs = [
    col("a", { defaultWidth: 200, minWidth: 100 }),
    col("b", { defaultWidth: 200, minWidth: 100 }),
    col("spacer", { minWidth: 0 }),
    col("actions", { defaultWidth: 40, minWidth: 40, resizable: false }),
  ];
  const visible = resolveTableColumns(defs, null);
  // 540 available, 440 used: 100 spare in the spacer.
  const resize = (id: string, target: number, cols = visible) =>
    Object.fromEntries(
      resizeColumnWidth(cols, fitColumnWidths(cols, 540), id, target, 540),
    );

  it("grows into spare room, then takes from the neighbour down to its minimum", () => {
    expect(resize("a", 250)).toEqual({ a: 250, b: 200, actions: 40 });
    expect(resize("a", 350)).toEqual({ a: 350, b: 150, actions: 40 });
    expect(resize("a", 800)).toEqual({ a: 400, b: 100, actions: 40 });
  });

  it("never takes from a fixed column", () => {
    expect(resize("b", 800)).toEqual({ a: 200, b: 300, actions: 40 });
  });

  it("hands shrunk room to the slack column, or the neighbour without one", () => {
    expect(resize("a", 150)).toEqual({ a: 150, b: 200, actions: 40 });
    const noSlack = visible.filter((c) => c.id !== "spacer");
    expect(resize("a", 150, noSlack)).toEqual({ a: 150, b: 250, actions: 40 });
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
