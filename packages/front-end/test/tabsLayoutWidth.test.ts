import { layoutWidth } from "@/ui/Tabs";

const el = (rectWidth: number, offsetWidth = rectWidth) =>
  ({
    getBoundingClientRect: () => ({ width: rectWidth }),
    offsetWidth,
  }) as unknown as HTMLElement;

describe("layoutWidth", () => {
  it("is the on-screen width when nothing scales the list", () => {
    expect(layoutWidth(el(80), el(400))).toBe(80);
  });

  it("undoes a transform or zoom around the list", () => {
    // Drawn at twice its 400px layout width, as in an opening dialog.
    expect(layoutWidth(el(160), el(800, 400))).toBe(80);
    expect(layoutWidth(el(40), el(200, 400))).toBe(80);
  });

  it("falls back to the on-screen width for a hidden list", () => {
    expect(layoutWidth(el(0), el(0, 0))).toBe(0);
    expect(layoutWidth(el(80), el(0, 0))).toBe(80);
  });
});
