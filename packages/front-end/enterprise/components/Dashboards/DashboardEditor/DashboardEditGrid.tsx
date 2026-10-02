import React, { useCallback, useMemo, useState } from "react";
import {
  DashboardBlockInterface,
  DashboardBlockInterfaceOrData,
  DashboardBlockType,
  DASHBOARD_GRID_ROW_HEIGHT_DEFAULT,
} from "shared/enterprise";
import { isDefined } from "shared/util";
import clsx from "clsx";
import {
  LayoutItem,
  ResponsiveGridLayout,
  useContainerWidth,
  verticalCompactor,
} from "react-grid-layout";
import Button from "@/ui/Button";
import Tooltip from "@/components/Tooltip/Tooltip";
import { AddBlockDropdown } from "./DashboardBlockTypeMenu";
import { getAvailableBlockTypes } from "./dashboardBlockTypes";
import {
  AddBlockOptions,
  blockFitsGap,
  buildRGLLayout,
  DASHBOARD_GRID_MARGIN,
  getGridKeyForBlock,
  getHorizontalGridGaps,
  gridRectToPixels,
} from "./dashboardLayout";
import {
  RGL_BREAKPOINTS,
  RGL_COLS,
  RGL_CANONICAL_BREAKPOINT,
  CANONICAL_COL_BREAKPOINTS,
} from "./dashboardGridConfig";

export interface DashboardEditGridProps {
  blocks: DashboardBlockInterfaceOrData<DashboardBlockInterface>[];
  editSidebarDirty: boolean;
  stagedBlockIndex: number | undefined;
  isAddingBlock: boolean;
  updateLayout: ((layout: readonly LayoutItem[]) => void) | undefined;
  addBlockType:
    | ((blockType: DashboardBlockType, options?: AddBlockOptions) => void)
    | undefined;
  isGeneralDashboard: boolean;
  renderBlock: (
    block: DashboardBlockInterfaceOrData<DashboardBlockInterface>,
    index: number,
  ) => React.ReactNode;
}

export default function DashboardEditGrid({
  blocks,
  editSidebarDirty,
  stagedBlockIndex,
  isAddingBlock,
  updateLayout,
  addBlockType,
  isGeneralDashboard,
  renderBlock,
}: DashboardEditGridProps) {
  const { width, containerRef, mounted } = useContainerWidth({
    initialWidth: 1280,
  });
  const [openGapKey, setOpenGapKey] = useState<string | null>(null);
  const [isGridInteracting, setIsGridInteracting] = useState(false);

  const layout = useMemo(() => {
    const nextLayout = buildRGLLayout(
      blocks,
      RGL_COLS[RGL_CANONICAL_BREAKPOINT],
    );
    if (!isDefined(stagedBlockIndex) || isAddingBlock) return nextLayout;
    return nextLayout.map((item, index) => ({
      ...item,
      static: index !== stagedBlockIndex,
    }));
  }, [blocks, isAddingBlock, stagedBlockIndex]);
  const gaps = useMemo(() => {
    if (
      !addBlockType ||
      editSidebarDirty ||
      isGridInteracting ||
      blocks.some((block) => !block.layout) ||
      isDefined(stagedBlockIndex)
    ) {
      return [];
    }
    const allowedBlockTypes = getAvailableBlockTypes(isGeneralDashboard);
    return getHorizontalGridGaps(layout).filter((gap) =>
      allowedBlockTypes.some((blockType) => blockFitsGap(blockType, gap)),
    );
  }, [
    addBlockType,
    blocks,
    editSidebarDirty,
    isGeneralDashboard,
    isGridInteracting,
    layout,
    stagedBlockIndex,
  ]);
  const layouts = useMemo(() => {
    return Object.fromEntries(
      CANONICAL_COL_BREAKPOINTS.map((bp) => [bp, layout]),
    ) as Partial<Record<keyof typeof RGL_BREAKPOINTS, LayoutItem[]>>;
  }, [layout]);

  const persistLayout = useCallback(
    (next: readonly LayoutItem[]) => {
      if (!updateLayout) return;
      updateLayout(next);
    },
    [updateLayout],
  );

  const isInteractive = !isAddingBlock;
  const showDisabledResizeOverlay = !isInteractive;

  return (
    <div
      ref={containerRef as unknown as React.RefObject<HTMLDivElement>}
      className={clsx("dashboard-grid-container", { "is-editing": true })}
    >
      {mounted && (
        <ResponsiveGridLayout
          width={width}
          className={clsx("dashboard-grid", {
            "is-editing": true,
            "is-resize-disabled": showDisabledResizeOverlay,
          })}
          layouts={layouts}
          breakpoints={RGL_BREAKPOINTS}
          cols={RGL_COLS}
          rowHeight={DASHBOARD_GRID_ROW_HEIGHT_DEFAULT}
          margin={[DASHBOARD_GRID_MARGIN, DASHBOARD_GRID_MARGIN]}
          containerPadding={[0, 0]}
          dragConfig={{
            enabled: isInteractive,
            handle: ".dashboard-block-drag-handle",
            bounded: false,
            threshold: 3,
          }}
          resizeConfig={{
            enabled: isInteractive,
            handles: ["se", "sw"],
          }}
          compactor={verticalCompactor}
          onDragStart={() => {
            setOpenGapKey(null);
            setIsGridInteracting(true);
          }}
          // Persist only after a drag or resize finishes. onLayoutChange also
          // fires on mount and responsive reflow, which must not overwrite saved layouts.
          onDragStop={(curr) => {
            persistLayout(curr);
            setIsGridInteracting(false);
          }}
          onResizeStart={() => {
            setOpenGapKey(null);
            setIsGridInteracting(true);
          }}
          onResizeStop={(curr) => {
            persistLayout(curr);
            setIsGridInteracting(false);
          }}
        >
          {blocks.map((block, i) => {
            const key = getGridKeyForBlock(block, i);
            return (
              <div
                key={key}
                className={clsx("dashboard-grid-item", {
                  "is-grid-interaction-disabled":
                    isDefined(stagedBlockIndex) && i !== stagedBlockIndex,
                })}
              >
                {renderBlock(block, i)}
                {showDisabledResizeOverlay && (
                  <Tooltip
                    body="Close the edit panel to resize this block"
                    tipPosition="top"
                    className="dashboard-resize-handle-disabled-overlay"
                    usePortal
                  >
                    <span aria-hidden />
                  </Tooltip>
                )}
              </div>
            );
          })}
        </ResponsiveGridLayout>
      )}
      {mounted &&
        addBlockType &&
        gaps.map((gap) => {
          const gapKey = `${gap.x}-${gap.y}-${gap.w}-${gap.h}`;
          const gapStyle = gridRectToPixels({
            rect: gap,
            containerWidth: width,
            rowHeight: DASHBOARD_GRID_ROW_HEIGHT_DEFAULT,
          });

          return (
            <div
              key={gapKey}
              className={clsx("dashboard-grid-add-block-gap", {
                "is-open": openGapKey === gapKey,
              })}
              style={gapStyle}
            >
              <AddBlockDropdown
                isGeneralDashboard={isGeneralDashboard}
                filterBlockType={(blockType) => blockFitsGap(blockType, gap)}
                onDropdownOpen={() => setOpenGapKey(gapKey)}
                onDropdownClose={() =>
                  setOpenGapKey((currentKey) =>
                    currentKey === gapKey ? null : currentKey,
                  )
                }
                addBlockType={(blockType) => {
                  addBlockType(blockType, {
                    index: gap.insertIndex,
                    placement: "gap",
                    initialLayout: {
                      x: gap.x,
                      y: gap.y,
                      w: gap.w,
                      h: gap.h,
                    },
                  });
                }}
                trigger={
                  <Button size="sm" variant="outline">
                    Add block
                  </Button>
                }
              />
            </div>
          );
        })}
    </div>
  );
}
