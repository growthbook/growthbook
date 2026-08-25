import {
  BlockSizeHint,
  packDashboardBlocks,
} from "../../src/enterprise/dashboards/autoLayout";
import {
  DASHBOARD_GRID_COLS,
  DashboardBlockType,
} from "../../src/enterprise/validators/dashboard-block";

function block(type: DashboardBlockType, sizeHint?: BlockSizeHint) {
  return { block: { type, title: "", description: "" }, sizeHint };
}

const layouts = (
  packed: { layout: { x: number; y: number; w: number; h: number } }[],
) => packed.map((p) => p.layout);

describe("packDashboardBlocks", () => {
  it("stacks full-width blocks one per row", () => {
    const packed = packDashboardBlocks([
      block("markdown", "full"),
      block("metric-exploration", "full"),
    ]);

    expect(layouts(packed)).toEqual([
      { x: 0, y: 0, w: DASHBOARD_GRID_COLS, h: 3 },
      { x: 0, y: 3, w: DASHBOARD_GRID_COLS, h: 8 },
    ]);
  });

  it("puts two medium blocks side by side and wraps the third", () => {
    const packed = packDashboardBlocks([
      block("metric-exploration", "medium"),
      block("metric-exploration", "medium"),
      block("metric-exploration", "medium"),
    ]);

    expect(layouts(packed)).toEqual([
      { x: 0, y: 0, w: 12, h: 8 },
      { x: 12, y: 0, w: 12, h: 8 },
      { x: 0, y: 8, w: 12, h: 8 },
    ]);
  });

  it("puts three small blocks in one row, at reduced height", () => {
    const packed = packDashboardBlocks([
      block("metric-exploration", "small"),
      block("metric-exploration", "small"),
      block("metric-exploration", "small"),
    ]);

    expect(layouts(packed)).toEqual([
      { x: 0, y: 0, w: 8, h: 4 },
      { x: 8, y: 0, w: 8, h: 4 },
      { x: 16, y: 0, w: 8, h: 4 },
    ]);
  });

  it("gives blocks sharing a row the tallest member's height", () => {
    // markdown defaults to h:3, metric-exploration to h:8 — the row takes 8, so
    // the next row starts at y:8 rather than overlapping it.
    const packed = packDashboardBlocks([
      block("markdown", "medium"),
      block("metric-exploration", "medium"),
      block("markdown", "full"),
    ]);

    expect(layouts(packed)).toEqual([
      { x: 0, y: 0, w: 12, h: 8 },
      { x: 12, y: 0, w: 12, h: 8 },
      { x: 0, y: 8, w: DASHBOARD_GRID_COLS, h: 3 },
    ]);
  });

  it("defaults to full width when no hint is given", () => {
    const packed = packDashboardBlocks([block("experiments-status")]);

    expect(packed[0].layout.w).toBe(DASHBOARD_GRID_COLS);
  });

  it("widens a block up to its type's minW", () => {
    // experiment-metric has minW:12, so a "small" hint (8) must not produce a
    // layout the grid would snap wider on first drag.
    const packed = packDashboardBlocks([block("experiment-metric", "small")]);

    expect(packed[0].layout.w).toBe(12);
  });

  it("never exceeds a narrower grid, even when minW would", () => {
    const packed = packDashboardBlocks(
      [block("experiment-metric", "full"), block("markdown", "medium")],
      6,
    );

    expect(layouts(packed)).toEqual([
      { x: 0, y: 0, w: 6, h: 8 },
      { x: 0, y: 8, w: 6, h: 3 },
    ]);
  });

  it("returns an empty array for no blocks", () => {
    expect(packDashboardBlocks([])).toEqual([]);
  });

  it("preserves the original block fields", () => {
    const packed = packDashboardBlocks([
      { block: { type: "markdown" as const, title: "Notes", content: "hi" } },
    ]);

    expect(packed[0].title).toBe("Notes");
    expect(packed[0].content).toBe("hi");
  });
});
