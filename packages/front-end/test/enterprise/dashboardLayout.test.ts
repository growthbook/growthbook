import {
  DashboardBlockInterface,
  DashboardBlockInterfaceOrData,
} from "shared/enterprise";
import { getPreviewBlocks } from "@/enterprise/components/Dashboards/DashboardEditor/dashboardLayout";

function block({
  id,
  x,
  y,
}: {
  id: string;
  x?: number;
  y?: number;
}): DashboardBlockInterfaceOrData<DashboardBlockInterface> {
  return {
    id,
    type: "markdown",
    title: id,
    content: id,
    ...(x !== undefined && y !== undefined
      ? { layout: { x, y, w: 6, h: 4 } }
      : {}),
  } as DashboardBlockInterfaceOrData<DashboardBlockInterface>;
}

describe("getPreviewBlocks", () => {
  it("returns the original array when maxBlocks is omitted", () => {
    const blocks = [block({ id: "a" }), block({ id: "b" })];
    expect(getPreviewBlocks(blocks)).toBe(blocks);
  });

  it("sorts by layout y then x instead of array order", () => {
    const blocks = [
      block({ id: "bottom", x: 0, y: 8 }),
      block({ id: "top-right", x: 6, y: 0 }),
      block({ id: "top-left", x: 0, y: 0 }),
    ];
    const preview = getPreviewBlocks(blocks, 2);
    expect(preview.map((b) => b.title)).toEqual(["top-left", "top-right"]);
  });

  it("rebases y so the first visible row starts at 0", () => {
    const blocks = [
      block({ id: "a", x: 0, y: 10 }),
      block({ id: "b", x: 0, y: 14 }),
    ];
    const preview = getPreviewBlocks(blocks, 2);
    expect(preview[0]?.layout?.y).toBe(0);
    expect(preview[1]?.layout?.y).toBe(4);
  });
});
