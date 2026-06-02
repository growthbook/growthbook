import {
  cellText,
  computeColumnWidths,
} from "@/components/Queries/QueryResultTable/columnWidths";
import {
  CELL_BORDER,
  CELL_PADDING,
  COLUMN_WIDTH_BUFFER,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
} from "@/components/Queries/QueryResultTable/constants";

describe("cellText", () => {
  it("JSON-stringifies primitives the way a cell renders them", () => {
    expect(cellText("hello")).toBe('"hello"');
    expect(cellText(42)).toBe("42");
    expect(cellText(true)).toBe("true");
  });

  it('renders null and undefined as the literal "null"', () => {
    expect(cellText(null)).toBe("null");
    expect(cellText(undefined)).toBe("null");
  });
});

// jsdom has no canvas 2d context, so computeColumnWidths exercises its
// no-canvas estimate branch here (len * 7 px per glyph).
describe("computeColumnWidths (no-canvas estimate path)", () => {
  const pad = CELL_PADDING * 2 + CELL_BORDER + COLUMN_WIDTH_BUFFER;
  const estimateWidth = (len: number) =>
    Math.min(
      MAX_COLUMN_WIDTH,
      Math.max(MIN_COLUMN_WIDTH, Math.ceil(len * 7) + pad),
    );

  it("returns one width per column plus the leading index column", () => {
    const rows = [{ a: 1, b: 2 }];
    expect(computeColumnWidths(rows, ["a", "b"])).toHaveLength(3);
  });

  it("sizes a data column to the wider of its header or its widest value", () => {
    const rows = [{ name: "x" }, { name: "a-very-long-value" }];
    const [, nameWidth] = computeColumnWidths(rows, ["name"]);
    // widest value "a-very-long-value" (17 chars) + quotes = 19 beats header 4.
    expect(nameWidth).toBe(estimateWidth(19));
  });

  it("clamps very wide content to MAX_COLUMN_WIDTH", () => {
    const rows = [{ wide: "x".repeat(500) }];
    const [, wideWidth] = computeColumnWidths(rows, ["wide"]);
    expect(wideWidth).toBe(MAX_COLUMN_WIDTH);
  });

  it("never returns a column narrower than MIN_COLUMN_WIDTH", () => {
    const rows = [{ a: 1 }];
    for (const width of computeColumnWidths(rows, ["a"])) {
      expect(width).toBeGreaterThanOrEqual(MIN_COLUMN_WIDTH);
    }
  });

  it("sizes the index column from the largest row number", () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ({ a: i }));
    const [indexWidth] = computeColumnWidths(rows, ["a"]);
    // Largest index label is "999" (3 chars).
    expect(indexWidth).toBe(estimateWidth(3));
  });

  it("handles an empty result set without throwing", () => {
    expect(computeColumnWidths([], [])).toEqual([estimateWidth(0)]);
  });

  it("measures the projected text from a custom getCellText, not the raw value", () => {
    // Raw JSON would be '"fact__abc"' (11 chars); the projection renders a
    // longer display name, so the column must size to the name instead.
    const rows = [{ id: "fact__abc" }];
    const name = "A Friendly Metric Name";
    const [, idWidth] = computeColumnWidths(rows, ["id"], () => name);
    expect(idWidth).toBe(estimateWidth(name.length));
  });
});
