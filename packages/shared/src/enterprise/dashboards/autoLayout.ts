import {
  BlockLayout,
  DASHBOARD_GRID_COLS,
  DashboardBlockType,
  getBlockSizeBounds,
} from "../validators/dashboard-block";

/**
 * Coarse width intent for a block, used when a dashboard is assembled
 * programmatically (e.g. by the AI dashboard builder) rather than dragged out
 * by hand.
 *
 * Deliberately three buckets rather than raw column counts: the caller decides
 * "this is a KPI tile" / "this pairs with its neighbour" / "this needs the full
 * width" and `packDashboardBlocks` owns the arithmetic, so every generated
 * dashboard lands on the same grid rhythm.
 */
export type BlockSizeHint = "small" | "medium" | "full";

/**
 * Column width per hint, against the canonical 24-column grid.
 *
 * `small` is 8 (three across) and not 6 (four across) on purpose:
 * `DEFAULT_BLOCK_SIZE_BY_TYPE` sets `minW: 8` on every exploration block, and
 * `minW` is injected at render time rather than persisted. A 6-wide block would
 * therefore save happily and then jump to 8 the first time the user dragged it.
 * Four-across KPI rows need those `minW` values lowered first.
 */
const HINT_WIDTH: Record<BlockSizeHint, number> = {
  small: 8,
  medium: 12,
  full: DASHBOARD_GRID_COLS,
};

/**
 * Row height for `small` blocks. The per-type default (8) is tuned for a chart
 * with axes; a KPI tile showing one number only needs about half that, and a
 * KPI row that is as tall as the trend charts below it reads as the wrong thing
 * being emphasised.
 */
const SMALL_BLOCK_HEIGHT = 4;

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

export interface BlockToPack<T> {
  block: T;
  sizeHint?: BlockSizeHint;
}

/**
 * Resolve the width a block wants, honoring both the grid ceiling and the
 * block type's own `minW` so the packed result is stable under the first drag.
 */
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
 * Assign every block an explicit grid `layout`, packing them left to right into
 * rows and wrapping when the next block no longer fits.
 *
 * Blocks that share a row also share that row's height (the tallest member), so
 * a row's tops and bottoms line up instead of leaving ragged gaps that the user
 * then has to tidy by hand.
 *
 * Output always satisfies `blockLayoutInterface`. `normalizeLayouts` on the
 * back-end stays the authority on persisted layouts — this is what produces a
 * sensible arrangement in the first place, not a replacement for that clamp.
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
