import {
  buildDiffRows,
  DiffRow,
} from "@/components/AuditHistoryExplorer/VirtualizedDiff";

const lines = (n: number, prefix = "line") =>
  Array.from({ length: n }, (_, i) => `${prefix} ${i + 1}`).join("\n") + "\n";

// Compact picture of rows: "=" same, "~" changed both sides, "-"/"+" one side,
// "…n" a fold of n lines
const shape = (rows: DiffRow[] | null) =>
  rows?.map((r) =>
    r.type === "fold"
      ? `…${r.rows.length}`
      : r.type === "same"
        ? "="
        : r.left && r.right
          ? "~"
          : r.left
            ? "-"
            : "+",
  );

describe("buildDiffRows", () => {
  it("pairs a removed and added run side by side, with leftovers on one side", () => {
    const rows = buildDiffRows("a\nb\nc\nd\n", "a\nB\nC\nX\nY\nd\n");
    expect(shape(rows)).toEqual(["=", "~", "~", "+", "+", "="]);
    const second = rows?.[1];
    expect(second?.type === "changed" && second.left?.number).toBe(2);
    expect(second?.type === "changed" && second.right?.text).toBe("B");
  });

  it("folds unchanged runs, keeping three lines of context around changes", () => {
    const before = lines(20);
    const after = before.replace("line 10\n", "line ten\n");
    expect(shape(buildDiffRows(before, after))).toEqual([
      "…6",
      "=",
      "=",
      "=",
      "~",
      "=",
      "=",
      "=",
      "…7",
    ]);
  });

  it("keeps short unchanged runs between changes instead of folding them", () => {
    const rows = buildDiffRows("a\nb\nc\nd\ne\n", "A\nb\nc\nd\nE\n");
    expect(shape(rows)).toEqual(["~", "=", "=", "=", "~"]);
  });

  it("gives up past the time limit, and compares anyway without one", () => {
    const before = lines(3000, "a");
    const after = lines(3000, "b");
    expect(buildDiffRows(before, after, 1)).toBeNull();
    expect(buildDiffRows(before, after, null)).not.toBeNull();
  });
});
