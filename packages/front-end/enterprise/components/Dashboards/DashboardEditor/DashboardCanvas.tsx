import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { PiCaretDownFill } from "react-icons/pi";
import {
  DashboardBlockInterfaceOrData,
  DashboardBlockInterface,
  DashboardBlockType,
  dashboardBlockHasIds,
  DashboardInterface,
  DASHBOARD_GRID_COLS,
  DASHBOARD_GRID_ROW_HEIGHT_DEFAULT,
  getBlockSizeBounds,
} from "shared/enterprise";
import { isDefined } from "shared/util";
import { Flex } from "@radix-ui/themes";
import clsx from "clsx";
import {
  LayoutItem,
  ResponsiveGridLayout,
  verticalCompactor,
} from "react-grid-layout";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import Tooltip from "@/components/Tooltip/Tooltip";
import { DashboardChartsProvider } from "@/enterprise/components/Dashboards/DashboardChartsContext";
import DashboardBlock from "./DashboardBlock";
import { AddBlockDropdown } from "./DashboardBlockTypeMenu";
import { getAvailableBlockTypes } from "./dashboardBlockTypes";
import {
  AddBlockOptions,
  blockFitsGap,
  DASHBOARD_GRID_MARGIN,
  getHorizontalGridGaps,
  gridRectToPixels,
} from "./dashboardLayout";

// Stable RGL key for a block (uses block id when persisted, else a synthetic
// key for the at-most-one staged add block).
export function getGridKeyForBlock(
  block: DashboardBlockInterfaceOrData<DashboardBlockInterface>,
  index: number,
): string {
  return dashboardBlockHasIds(block) ? block.id : `__staged_block_${index}__`;
}

// Build the RGL LayoutItem[] from blocks. Blocks without an existing layout
// get stacked full-width below the highest occupied y so they don't collide.
// minW/minH come from the shared per-type defaults, and a block saved shorter
// than its minH is shown at it; maxW is the absolute grid cap. Height is
// intentionally uncapped. None of these constraints are persisted.
export function buildRGLLayout(
  blocks: DashboardBlockInterfaceOrData<DashboardBlockInterface>[],
  cols: number = DASHBOARD_GRID_COLS,
): LayoutItem[] {
  let nextY = 0;
  blocks.forEach((b) => {
    if (b.layout) {
      nextY = Math.max(nextY, b.layout.y + b.layout.h);
    }
  });
  return blocks.map((block, index) => {
    const i = getGridKeyForBlock(block, index);
    const bounds = getBlockSizeBounds(block.type);
    const maxW = cols;
    if (block.layout) {
      const item: LayoutItem = {
        i,
        x: block.layout.x,
        y: block.layout.y,
        w: Math.min(block.layout.w, maxW),
        h: Math.max(bounds.minH, block.layout.h),
        minW: bounds.minW,
        minH: bounds.minH,
        maxW,
      };
      if (block.layout.static) item.static = true;
      return item;
    }
    const w = Math.min(bounds.w, maxW);
    const h = Math.max(1, bounds.h);
    const layout: LayoutItem = {
      i,
      x: 0,
      y: nextY,
      w,
      h,
      minW: bounds.minW,
      minH: bounds.minH,
      maxW,
    };
    nextY += h;
    return layout;
  });
}

// Every breakpoint uses the same canonical column count. We intentionally do
// NOT degrade to fewer cols at narrower widths because RGL's auto-derived
// layout for a smaller-col breakpoint compacts in *array order*, silently
// reordering the user's saved x positions. Keeping cols constant means cells
// just shrink proportionally and the canonical layout is always honored,
// regardless of the container width (e.g. when the editing drawer opens).
const RGL_BREAKPOINTS = { lg: 1200, md: 996, sm: 768, xs: 0 } as const;
const RGL_COLS = {
  lg: DASHBOARD_GRID_COLS,
  md: DASHBOARD_GRID_COLS,
  sm: DASHBOARD_GRID_COLS,
  xs: DASHBOARD_GRID_COLS,
} as const;
const RGL_CANONICAL_BREAKPOINT: keyof typeof RGL_BREAKPOINTS = "lg";

const CANONICAL_COL_BREAKPOINTS: ReadonlyArray<keyof typeof RGL_BREAKPOINTS> = (
  Object.keys(RGL_COLS) as Array<keyof typeof RGL_COLS>
).filter((bp) => RGL_COLS[bp] === RGL_COLS[RGL_CANONICAL_BREAKPOINT]);

export interface EditBlockProps {
  scrollAreaRef: null | React.MutableRefObject<HTMLDivElement | null>;
  editSidebarDirty: boolean;
  focusedBlockIndex: number | undefined;
  stagedBlockIndex: number | undefined;
  isAddingBlock: boolean;
  addBlockType: (
    blockType: DashboardBlockType,
    options?: AddBlockOptions,
  ) => void;
  editBlock: (index: number) => void;
  duplicateBlock: (index: number) => void;
  deleteBlock: (index: number) => void;
  updateLayout: (layout: readonly LayoutItem[]) => void;
}

// What the canvas needs to edit blocks. Without it the canvas is read-only.
export interface DashboardCanvasEdit {
  isEditing: boolean;
  canEdit: boolean;
  setIsEditing?: (v: boolean) => void;
  enterEditModeForBlock?: (blockIndex: number) => void;
  editBlockProps?: EditBlockProps;
}

interface Props {
  blocks: DashboardBlockInterfaceOrData<DashboardBlockInterface>[];
  isTabActive: boolean;
  isGeneralDashboard: boolean;
  globalControls?: DashboardInterface["globalControls"];
  dashboardComparison?: DashboardInterface["comparison"];
  setBlock?: (
    index: number,
    block: DashboardBlockInterfaceOrData<DashboardBlockInterface>,
  ) => void;
  mutate?: () => void;
  edit?: DashboardCanvasEdit;
  // Blocks run themselves, for hosts with no dashboard header
  selfUpdate?: boolean;
}

const noop = () => undefined;

export default function DashboardCanvas({
  blocks,
  isTabActive,
  isGeneralDashboard,
  globalControls,
  dashboardComparison,
  setBlock,
  mutate = noop,
  edit,
  selfUpdate = false,
}: Props) {
  const isEditing = edit?.isEditing ?? false;
  const canEdit = edit?.canEdit ?? false;
  const setIsEditing = edit?.setIsEditing;
  const enterEditModeForBlock = edit?.enterEditModeForBlock;
  const {
    editSidebarDirty,
    focusedBlockIndex,
    stagedBlockIndex,
    isAddingBlock,
    scrollAreaRef,
    addBlockType,
    editBlock,
    duplicateBlock,
    deleteBlock,
    updateLayout,
  } = edit?.editBlockProps ?? {};

  const renderSingleBlock = ({
    i,
    block,
    isFocused,
    setBlock,
    isEditingBlock,
  }: {
    i: number;
    block: DashboardBlockInterfaceOrData<DashboardBlockInterface>;
    isFocused: boolean;
    setBlock:
      | undefined
      | React.Dispatch<DashboardBlockInterfaceOrData<DashboardBlockInterface>>;
    isEditingBlock: boolean;
  }) => {
    return (
      <DashboardBlock
        isTabActive={isTabActive}
        block={block}
        dashboardGlobalControls={globalControls}
        dashboardComparison={dashboardComparison}
        blockIndex={i}
        isEditing={isEditing}
        isFocused={isFocused}
        editingBlock={isEditingBlock}
        canMoveBlock={
          !isDefined(stagedBlockIndex) || (!isAddingBlock && isEditingBlock)
        }
        disableBlock={
          editSidebarDirty && !isEditingBlock
            ? "full"
            : isDefined(stagedBlockIndex)
              ? "partial"
              : "none"
        }
        scrollAreaRef={scrollAreaRef ?? null}
        setBlock={setBlock}
        editBlock={editBlock ? () => editBlock(i) : () => {}}
        duplicateBlock={duplicateBlock ? () => duplicateBlock(i) : () => {}}
        deleteBlock={deleteBlock ? () => deleteBlock(i) : () => {}}
        addBlockBefore={
          addBlockType
            ? (blockType) =>
                addBlockType(blockType, { index: i, placement: "before" })
            : undefined
        }
        addBlockAfter={
          addBlockType
            ? (blockType) =>
                addBlockType(blockType, {
                  index: i + 1,
                  placement: "after",
                })
            : undefined
        }
        isGeneralDashboard={isGeneralDashboard}
        mutate={mutate}
        canEdit={canEdit}
        setIsEditing={setIsEditing}
        enterEditModeForBlock={enterEditModeForBlock}
        selfUpdate={selfUpdate}
      />
    );
  };

  return (
    <DashboardChartsProvider>
      <div>
        {blocks.length === 0 && !edit ? (
          <Text color="text-mid">This dashboard has no blocks yet.</Text>
        ) : blocks.length === 0 ? (
          <Flex
            direction="column"
            align="center"
            justify="center"
            px="80px"
            pt="60px"
            pb="70px"
            className="appbox"
            gap="5"
          >
            <Flex direction="column">
              <Heading as="h1" size="lg" weight="medium" align="center">
                Add Content Blocks
              </Heading>
              <Text align="center">
                {addBlockType
                  ? "Choose a block type to get started."
                  : "Add some blocks to get started"}
              </Text>
            </Flex>
            {addBlockType ? (
              <AddBlockDropdown
                addBlockType={addBlockType}
                isGeneralDashboard={isGeneralDashboard}
                trigger={
                  <Button
                    size="md"
                    icon={<PiCaretDownFill />}
                    iconPosition="right"
                  >
                    Add block
                  </Button>
                }
              />
            ) : canEdit && setIsEditing ? (
              <Button size="lg" onClick={() => setIsEditing(true)}>
                Add block
              </Button>
            ) : null}
          </Flex>
        ) : (
          <DashboardGrid
            blocks={blocks}
            isEditing={isEditing}
            editSidebarDirty={!!editSidebarDirty}
            stagedBlockIndex={stagedBlockIndex}
            isAddingBlock={!!isAddingBlock}
            updateLayout={updateLayout}
            addBlockType={addBlockType}
            isGeneralDashboard={isGeneralDashboard}
            renderBlock={(block, i) =>
              renderSingleBlock({
                i,
                block,
                isFocused: focusedBlockIndex === i,
                setBlock: setBlock ? (block) => setBlock(i, block) : undefined,
                isEditingBlock: stagedBlockIndex === i,
              })
            }
          />
        )}
        {isEditing && blocks.length > 0 && addBlockType && (
          <Flex
            justify="center"
            mt="3"
            className={clsx({
              "dashboard-disabled": editSidebarDirty,
            })}
          >
            <AddBlockDropdown
              addBlockType={addBlockType}
              isGeneralDashboard={isGeneralDashboard}
              trigger={
                <Button
                  size="md"
                  variant="outline"
                  icon={<PiCaretDownFill />}
                  iconPosition="right"
                >
                  Add block
                </Button>
              }
            />
          </Flex>
        )}
        {/* Add padding at the bottom so there's room to scroll the selected block to the middle/top of the page */}
        {isEditing && <div style={{ height: 350 }} />}
      </div>
    </DashboardChartsProvider>
  );
}

interface DashboardGridProps {
  blocks: DashboardBlockInterfaceOrData<DashboardBlockInterface>[];
  isEditing: boolean;
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

// The container's width, in whole pixels, once it has held for a frame: while
// a panel slides beside the grid, its blocks wait and lay out once, where the
// slide ends. Hidden with its tab the container measures 0, which is ignored,
// so the grid waits for a real width and keeps its last one meanwhile.
function useSettledWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    const observer = new ResizeObserver(([entry]) => {
      cancelAnimationFrame(frame);
      const next = Math.round(entry.contentRect.width);
      if (next === 0) return;
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => setWidth(next));
      });
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);
  return [ref, width] as const;
}

// Wraps blocks in react-grid-layout so users can drag, drop, and resize.
// Drag/resize are disabled outside edit mode and while a new block is being
// added. We only persist layout changes from the canonical (lg)
// breakpoint; smaller breakpoints are auto-derived for responsive viewing only.
function DashboardGrid({
  blocks,
  isEditing,
  editSidebarDirty,
  stagedBlockIndex,
  isAddingBlock,
  updateLayout,
  addBlockType,
  isGeneralDashboard,
  renderBlock,
}: DashboardGridProps) {
  const [containerRef, width] = useSettledWidth();
  const [openGapKey, setOpenGapKey] = useState<string | null>(null);
  const [isGridInteracting, setIsGridInteracting] = useState(false);

  const layout = useMemo(() => {
    const nextLayout = buildRGLLayout(
      blocks,
      RGL_COLS[RGL_CANONICAL_BREAKPOINT],
    );
    if (!isDefined(stagedBlockIndex) || isAddingBlock) return nextLayout;
    // Only the block being edited moves; the rest still make way for it.
    return nextLayout.map((item, index) =>
      index === stagedBlockIndex
        ? item
        : { ...item, isDraggable: false, isResizable: false },
    );
  }, [blocks, isAddingBlock, stagedBlockIndex]);
  const gaps = useMemo(() => {
    if (
      !isEditing ||
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
    isEditing,
    isGeneralDashboard,
    isGridInteracting,
    layout,
    stagedBlockIndex,
  ]);
  // Every breakpoint shares the same canonical column count, so we hand RGL
  // the same layout for all of them. This is what makes side-by-side blocks
  // keep their x positions when the editing drawer narrows the container.
  const layouts = useMemo(() => {
    return Object.fromEntries(
      CANONICAL_COL_BREAKPOINTS.map((bp) => [bp, layout]),
    ) as Partial<Record<keyof typeof RGL_BREAKPOINTS, LayoutItem[]>>;
  }, [layout]);

  // We only persist on onDragStop / onResizeStop - both are terminal,
  // user-initiated, and ship the final layout. onLayoutChange is deliberately
  // NOT a save trigger because RGL also fires it on mount (after running its
  // compactor), which would silently rewrite the user's saved positions when
  // simply opening the dashboard.
  const persistLayout = useCallback(
    (next: readonly LayoutItem[]) => {
      if (!updateLayout) return;
      updateLayout(next);
    },
    [updateLayout],
  );

  const isInteractive = isEditing && !isAddingBlock;
  // When we're in edit mode but interaction is disabled (because the edit
  // drawer is open), keep the resize handle visible-but-dimmed and surface a
  // tooltip explaining why it doesn't respond. Outside of edit mode the
  // handle is hidden entirely, so no overlay is needed.
  const showDisabledResizeOverlay = isEditing && !isInteractive;

  return (
    <div
      ref={containerRef}
      className={clsx("dashboard-grid-container", { "is-editing": isEditing })}
    >
      {width > 0 && (
        <ResponsiveGridLayout
          width={width}
          className={clsx("dashboard-grid", {
            "is-editing": isEditing,
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
                  // Tooltip wraps its children in an inline <span> and anchors
                  // its popper to that span. We put the overlay styles on the
                  // span itself (via className) so Popper measures the corner
                  // hit target instead of a collapsed zero-size box. The inner
                  // child is a placeholder to suppress Tooltip's GBInfo
                  // fallback when no children are provided.
                  <Tooltip
                    body="Close the edit panel to resize this block"
                    tipPosition="top"
                    className="dashboard-resize-handle-disabled-overlay"
                    // Render through a portal so the popper escapes the grid's
                    // stacking context - otherwise the edit drawer (which has
                    // its own stacking context above the grid) clips it.
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
      {width > 0 &&
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
