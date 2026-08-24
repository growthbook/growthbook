import {
  BlockLayout,
  DASHBOARD_GRID_COLS,
  DashboardBlockType,
  getBlockSizeBounds,
} from "../validators/dashboard-block";

/**
 * Coarse width intent for a programmatically assembled dashboard. Three buckets
 * rather than column counts, so the caller states intent and
 * `packDashboardBlocks` owns the arithmetic.
 */
export type BlockSizeHint = "small" | "medium" | "full";

/**
 * `small` is 8 (three across), not 6, on purpose: every exploration block has
 * `minW: 8`, injected at render rather than persisted, so a 6-wide block would
 * save fine and then jump to 8 on the first drag. Four-across needs `minW`
 * lowered first.
 */
const HINT_WIDTH: Record<BlockSizeHint, number> = {
  small: 8,
  medium: 12,
  full: DASHBOARD_GRID_COLS,
};

/** The per-type default (8) is tuned for a chart with axes; a KPI tile needs half. */
const SMALL_BLOCK_HEIGHT = 4;

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

export interface BlockToPack<T> {
  block: T;
  sizeHint?: BlockSizeHint;
}

/** Honors the grid ceiling and the type's `minW`, so the result survives a drag. */
function resolveWidth(
  type: DashboardBlockType,
  sizeHint: BlockSizeHint,
  cols: number,
): number {
  const { minW } = getBlockSizeBounds(type);
  // minW itself can exceed a narrow grid, so clamp to `cols` last.
  return clamp(Math.max(HINT_WIDTH[sizeHint], minW), 1, cols);
}

function resolveHeight(type: DashboardBlockType, sizeHint: BlockSizeHint) {
  const bounds = getBlockSizeBounds(type);
  const h = sizeHint === "small" ? SMALL_BLOCK_HEIGHT : bounds.h;
  return Math.max(1, h, bounds.minH);
}

/**
 * Pack blocks left to right into rows, wrapping when the next no longer fits.
 * Blocks sharing a row share its height (the tallest member) so tops and
 * bottoms line up. `normalizeLayouts` stays the authority on persisted layouts;
 * this only produces a sensible arrangement in the first place.
 */
export function packDashboardBlocks<T extends { type: DashboardBlockType }>(
  blocks: BlockToPack<T>[],
  cols: number = DASHBOARD_GRID_COLS,
): (T & { layout: BlockLayout })[] {
  const safeCols = Math.max(1, Math.floor(cols));

  const sized = blocks.map(({ block, sizeHint = "full" }) => ({
    block,
    w: resolveWidth(block.type, sizeHint, safeCols),
    h: resolveHeight(block.type, sizeHint),
  }));

  // Group into rows first so a row's height is known before any `y` is fixed.
  const rows: (typeof sized)[] = [];
  let current: typeof sized = [];
  let usedWidth = 0;
  for (const entry of sized) {
    if (current.length > 0 && usedWidth + entry.w > safeCols) {
      rows.push(current);
      current = [];
      usedWidth = 0;
    }
    current.push(entry);
    usedWidth += entry.w;
  }
  if (current.length > 0) rows.push(current);

  const packed: (T & { layout: BlockLayout })[] = [];
  let y = 0;
  for (const row of rows) {
    const rowHeight = Math.max(...row.map((entry) => entry.h));
    let x = 0;
    for (const { block, w } of row) {
      packed.push({
        ...block,
        layout: {
          x: clamp(x, 0, Math.max(0, safeCols - w)),
          y,
          w,
          h: rowHeight,
        },
      });
      x += w;
    }
    y += rowHeight;
  }

  return packed;
}
