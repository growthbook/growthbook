import {
  DASHBOARD_GRID_COLS,
  DashboardBlockInterface,
  DashboardBlockInterfaceOrData,
  DashboardBlockType,
  getBlockSizeBounds,
} from "shared/enterprise";
import { LayoutItem } from "react-grid-layout";

export const DASHBOARD_GRID_MARGIN = 12;

export type BlockInsertionPlacement = "before" | "after" | "gap";

export type AddBlockOptions = {
  index?: number;
  placement?: BlockInsertionPlacement;
  initialLayout?: NonNullable<DashboardBlockInterface["layout"]>;
};

export type DashboardGridGap = {
  x: number;
  y: number;
  w: number;
  h: number;
  insertIndex: number;
};

type DashboardBlock = DashboardBlockInterfaceOrData<DashboardBlockInterface>;

function insertAtIndex(
  blocks: DashboardBlock[],
  block: DashboardBlock,
  index: number,
): DashboardBlock[] {
  return [...blocks.slice(0, index), block, ...blocks.slice(index)];
}

function tryInsertInAnchorRow({
  blocks,
  block,
  index,
  placement,
}: {
  blocks: DashboardBlock[];
  block: DashboardBlock;
  index: number;
  placement: Exclude<BlockInsertionPlacement, "gap">;
}): DashboardBlock[] | null {
  const anchorIndex = placement === "before" ? index : index - 1;
  const anchorLayout =
    anchorIndex >= 0 ? blocks[anchorIndex]?.layout : undefined;
  if (!anchorLayout) return null;

  const rowBlocks = blocks.filter(
    (existingBlock) => existingBlock.layout?.y === anchorLayout.y,
  );
  const bounds = getBlockSizeBounds(block.type);
  const inferredWidth = block.layout?.w ?? anchorLayout.w;
  const inferredHeight = block.layout?.h ?? anchorLayout.h;
  if (inferredWidth < bounds.minW || inferredHeight < bounds.minH) return null;

  const precedingRowEnd = rowBlocks.reduce((maxX, existingBlock) => {
    if (!existingBlock.layout || existingBlock.layout.x >= anchorLayout.x) {
      return maxX;
    }
    return Math.max(maxX, existingBlock.layout.x + existingBlock.layout.w);
  }, 0);
  const insertionX =
    placement === "before" ? precedingRowEnd : anchorLayout.x + anchorLayout.w;
  const insertionEnd = insertionX + inferredWidth;
  const firstOverlappingX = rowBlocks.reduce((minX, existingBlock) => {
    if (
      !existingBlock.layout ||
      existingBlock.layout.x >= insertionEnd ||
      existingBlock.layout.x + existingBlock.layout.w <= insertionX
    ) {
      return minX;
    }
    return Math.min(minX, existingBlock.layout.x);
  }, Number.POSITIVE_INFINITY);
  const shiftX = Number.isFinite(firstOverlappingX)
    ? insertionEnd - firstOverlappingX
    : 0;
  const furthestEdge = rowBlocks.reduce((maxX, existingBlock) => {
    if (!existingBlock.layout) return maxX;
    const shiftedX =
      shiftX > 0 && existingBlock.layout.x >= firstOverlappingX
        ? existingBlock.layout.x + shiftX
        : existingBlock.layout.x;
    return Math.max(maxX, shiftedX + existingBlock.layout.w);
  }, insertionEnd);
  if (furthestEdge > DASHBOARD_GRID_COLS) return null;

  const blocksWithShiftedRow = blocks.map((existingBlock) => {
    if (
      existingBlock.layout?.y !== anchorLayout.y ||
      shiftX === 0 ||
      existingBlock.layout.x < firstOverlappingX
    ) {
      return existingBlock;
    }
    return {
      ...existingBlock,
      layout: {
        ...existingBlock.layout,
        x: existingBlock.layout.x + shiftX,
      },
    };
  });

  return insertAtIndex(
    blocksWithShiftedRow,
    {
      ...block,
      layout: {
        x: insertionX,
        y: anchorLayout.y,
        w: inferredWidth,
        h: inferredHeight,
      },
    },
    index,
  );
}

function insertInNewRow(
  blocks: DashboardBlock[],
  block: DashboardBlock,
  index: number,
): DashboardBlock[] {
  const precedingBlocks = blocks.slice(0, index);
  const followingBlocks = blocks.slice(index);
  const bounds = getBlockSizeBounds(block.type);
  const w = block.layout?.w ?? bounds.w;
  const h = block.layout?.h ?? bounds.h;
  const insertionY = precedingBlocks.reduce((maxY, existingBlock) => {
    if (!existingBlock.layout) return maxY;
    return Math.max(maxY, existingBlock.layout.y + existingBlock.layout.h);
  }, 0);
  const firstFollowingY = followingBlocks.reduce(
    (minY, existingBlock) =>
      existingBlock.layout ? Math.min(minY, existingBlock.layout.y) : minY,
    Number.POSITIVE_INFINITY,
  );
  const shiftY = Math.max(0, insertionY + h - firstFollowingY);
  const shiftedFollowingBlocks = followingBlocks.map((existingBlock) => {
    if (!existingBlock.layout) return existingBlock;
    return {
      ...existingBlock,
      layout: {
        ...existingBlock.layout,
        y: existingBlock.layout.y + shiftY,
      },
    };
  });

  return [
    ...precedingBlocks,
    {
      ...block,
      layout: {
        x: 0,
        y: insertionY,
        w: Math.min(w, DASHBOARD_GRID_COLS),
        h,
      },
    },
    ...shiftedFollowingBlocks,
  ];
}

export function insertBlockAtIndex(
  blocks: DashboardBlock[],
  block: DashboardBlock,
  index: number,
  placement?: BlockInsertionPlacement,
): DashboardBlock[] {
  if (placement === "gap" && block.layout) {
    return insertAtIndex(blocks, block, index);
  }
  if (blocks.some((existingBlock) => !existingBlock.layout)) {
    return block.layout
      ? insertInNewRow(blocks, block, index)
      : insertAtIndex(blocks, block, index);
  }
  if (placement === "before" || placement === "after") {
    const rowInsertion = tryInsertInAnchorRow({
      blocks,
      block,
      index,
      placement,
    });
    if (rowInsertion) return rowInsertion;
  }
  return insertInNewRow(blocks, block, index);
}

export function getHorizontalGridGaps(
  layout: readonly LayoutItem[],
): DashboardGridGap[] {
  const rows = new Map<number, Array<{ item: LayoutItem; index: number }>>();
  layout.forEach((item, index) => {
    const row = rows.get(item.y) ?? [];
    row.push({ item, index });
    rows.set(item.y, row);
  });

  const isEmptyRectangle = (gap: DashboardGridGap): boolean =>
    layout.every(
      (item) =>
        gap.x + gap.w <= item.x ||
        gap.x >= item.x + item.w ||
        gap.y + gap.h <= item.y ||
        gap.y >= item.y + item.h,
    );

  return [...rows.entries()].flatMap(([y, row]) => {
    const sortedRow = [...row].sort((a, b) => a.item.x - b.item.x);
    const h = Math.min(...sortedRow.map(({ item }) => item.h));
    const gaps: DashboardGridGap[] = [];
    let nextX = 0;

    sortedRow.forEach(({ item, index }) => {
      if (item.x > nextX) {
        gaps.push({
          x: nextX,
          y,
          w: item.x - nextX,
          h,
          insertIndex: index,
        });
      }
      nextX = Math.max(nextX, item.x + item.w);
    });

    const lastBlock = sortedRow[sortedRow.length - 1];
    if (lastBlock && nextX < DASHBOARD_GRID_COLS) {
      gaps.push({
        x: nextX,
        y,
        w: DASHBOARD_GRID_COLS - nextX,
        h,
        insertIndex: lastBlock.index + 1,
      });
    }

    return gaps.filter(isEmptyRectangle);
  });
}

export function blockFitsGap(
  blockType: DashboardBlockType,
  gap: DashboardGridGap,
): boolean {
  const bounds = getBlockSizeBounds(blockType);
  return bounds.minW <= gap.w && bounds.minH <= gap.h;
}

export function gridRectToPixels({
  rect,
  containerWidth,
  rowHeight,
}: {
  rect: Pick<DashboardGridGap, "x" | "y" | "w" | "h">;
  containerWidth: number;
  rowHeight: number;
}) {
  const columnWidth =
    (containerWidth - DASHBOARD_GRID_MARGIN * (DASHBOARD_GRID_COLS - 1)) /
    DASHBOARD_GRID_COLS;
  return {
    left: rect.x * (columnWidth + DASHBOARD_GRID_MARGIN),
    top: rect.y * (rowHeight + DASHBOARD_GRID_MARGIN),
    width: rect.w * columnWidth + (rect.w - 1) * DASHBOARD_GRID_MARGIN,
    height: rect.h * rowHeight + (rect.h - 1) * DASHBOARD_GRID_MARGIN,
  };
}
