// Defines when the virtualization kicks in
export const RESULT_TABLE_ROW_VIRTUALIZATION_THRESHOLD = 100;
export const RESULT_TABLE_COLUMN_VIRTUALIZATION_THRESHOLD = 25;

// Configuration for the tables
export const RESULT_TABLE_MAX_HEIGHT = 300;
export const RESULT_TABLE_ROW_OVERSCAN = 15;
export const RESULT_TABLE_COLUMN_OVERSCAN = 5;
export const COLUMN_WIDTH_BUFFER = 3;
export const MIN_COLUMN_WIDTH = 24;
export const MAX_COLUMN_WIDTH = 600;

// For the virtualizaed table, defines how many rows
// are sampled when sizing columns to content
export const WIDTH_SAMPLE_ROWS = 30;

// Copied from the styles that PlainQueryResultTable uses, from bootstrap's `table-sm`
// if we modify the design on how these are rendered, we should update it here so
// the virtualization has the proper values to match
export const CELL_FONT_SIZE = 14;
export const CELL_LINE_HEIGHT = 1.5;
export const CELL_PADDING = 4.8;
export const CELL_BORDER = 1;

export const RESULT_TABLE_ROW_HEIGHT = Math.round(
  CELL_FONT_SIZE * CELL_LINE_HEIGHT + CELL_PADDING * 2 + CELL_BORDER,
);
