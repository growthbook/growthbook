import {
  CELL_BORDER,
  CELL_FONT_SIZE,
  CELL_PADDING,
  COLUMN_WIDTH_BUFFER,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  WIDTH_SAMPLE_ROWS,
} from "./constants";

// Used to calculate column widths for column virtualization
export type GetCellText = (value: unknown) => string;

// By default we get the size of the JSON stringified value
export const cellText: GetCellText = (value) => JSON.stringify(value) ?? "null";

export function computeColumnWidths(
  rows: Record<string, unknown>[],
  columns: string[],
  getCellText: GetCellText = cellText,
): number[] {
  const widthOf = (textWidth: number) =>
    Math.min(
      MAX_COLUMN_WIDTH,
      Math.max(
        MIN_COLUMN_WIDTH,
        Math.ceil(textWidth) +
          CELL_PADDING * 2 +
          CELL_BORDER +
          COLUMN_WIDTH_BUFFER,
      ),
    );

  // Sample rows evenly rather than scanning every cell, so width
  // measurement stays cheap for very large result sets.
  const sampleStep =
    rows.length > WIDTH_SAMPLE_ROWS
      ? Math.floor(rows.length / WIDTH_SAMPLE_ROWS)
      : 1;

  const widestText: string[] = new Array(columns.length).fill("");
  const widestLength: number[] = new Array(columns.length).fill(-1);

  for (let r = 0; r < rows.length; r += sampleStep) {
    const row = rows[r];
    for (let c = 0; c < columns.length; c++) {
      const text = getCellText(row[columns[c]]);
      if (text.length > widestLength[c]) {
        widestLength[c] = text.length;
        widestText[c] = text;
      }
    }
  }

  // The last row has the most digits, so it's the widest index label
  const longestIndex = rows.length ? String(rows.length - 1) : "";

  const measure = makeTextMeasurer();

  return [
    // Index header is blank, so the column is sized purely by the numbers.
    widthOf(measure(longestIndex, true)),
    ...columns.map((key, i) =>
      widthOf(Math.max(measure(key, true), measure(widestText[i], false))),
    ),
  ];
}

// Does some magic via canvas to measure the width of text
function makeTextMeasurer(): (text: string, bold: boolean) => number {
  const ctx =
    typeof document !== "undefined"
      ? document.createElement("canvas").getContext("2d")
      : null;

  if (!ctx) {
    return (text) => text.length * 7;
  }

  const fontFamily = getComputedStyle(document.body).fontFamily || "sans-serif";
  const normalFont = `${CELL_FONT_SIZE}px ${fontFamily}`;
  const boldFont = `700 ${CELL_FONT_SIZE}px ${fontFamily}`;
  return (text, bold) => {
    ctx.font = bold ? boldFont : normalFont;
    return ctx.measureText(text).width;
  };
}
