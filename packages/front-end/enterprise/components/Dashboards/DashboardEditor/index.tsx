import React, { useCallback, useContext, useMemo, useState } from "react";
import { PiCaretDownFill, PiPencilSimpleFill } from "react-icons/pi";
import { BsThreeDotsVertical } from "react-icons/bs";
import {
  DashboardBlockInterfaceOrData,
  DashboardBlockInterface,
  DashboardBlockType,
  dashboardBlockHasIds,
  getBlockData,
  DashboardEditLevel,
  DashboardInterface,
  DashboardShareLevel,
  DashboardUpdateSchedule,
  DASHBOARD_GRID_COLS,
  DASHBOARD_GRID_ROW_HEIGHT_DEFAULT,
  getBlockSizeBounds,
} from "shared/enterprise";
import { isDefined } from "shared/util";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import clsx from "clsx";
import { withErrorBoundary } from "@sentry/nextjs";
import {
  LayoutItem,
  ResponsiveGridLayout,
  useContainerWidth,
  verticalCompactor,
} from "react-grid-layout";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";
import Callout from "@/ui/Callout";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useAuth } from "@/services/auth";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useUser } from "@/services/UserContext";
import ShareStatusBadge from "@/components/Report/ShareStatusBadge";
import ProjectBadges from "@/components/ProjectBadges";
import Owner from "@/components/Avatar/Owner";
import DashboardModal from "@/enterprise/components/Dashboards/DashboardModal";
import DashboardShareModal from "@/enterprise/components/Dashboards/DashboardShareModal";
import { DashboardChartsProvider } from "@/enterprise/components/Dashboards/DashboardChartsContext";
import Badge from "@/ui/Badge";
import AsyncQueriesModal from "@/components/Queries/AsyncQueriesModal";
import { DashboardSnapshotContext } from "@/enterprise/components/Dashboards/DashboardSnapshotProvider";
import DashboardUpdateDisplay from "./DashboardUpdateDisplay";
import DashboardBlock from "./DashboardBlock";
import DashboardGlobalControlsBar from "./DashboardGlobalControlsBar";
import { AddBlockDropdown } from "./DashboardBlockTypeMenu";
import { getAvailableBlockTypes } from "./dashboardBlockTypes";
import {
  AddBlockOptions,
  blockFitsGap,
  DASHBOARD_GRID_MARGIN,
  getHorizontalGridGaps,
  gridRectToPixels,
} from "./dashboardLayout";

export const DASHBOARD_TOPBAR_HEIGHT = "40px";
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
// minW/minH come from the shared per-type defaults; maxW is the absolute grid
// cap. Height is intentionally uncapped. None of these constraints are
// persisted.
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
        h: Math.max(1, block.layout.h),
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

interface EditBlockProps {
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

interface Props {
  isTabActive: boolean;
  title: string;
  blocks: DashboardBlockInterfaceOrData<DashboardBlockInterface>[];
  globalControlBlocks?: DashboardBlockInterfaceOrData<DashboardBlockInterface>[];
  id: string;
  isEditing: boolean;
  projects: string[];
  enableAutoUpdates: boolean;
  updateSchedule: DashboardUpdateSchedule | undefined;
  globalControls?: DashboardInterface["globalControls"];
  ownerId: string;
  initialEditLevel: DashboardEditLevel;
  initialShareLevel: DashboardShareLevel;
  dashboardOwnerId: string;
  nextUpdate: Date | undefined;
  dashboardLastUpdated?: Date;
  setBlock:
    | undefined
    | ((
        index: number,
        block: DashboardBlockInterfaceOrData<DashboardBlockInterface>,
      ) => void);
  mutate: () => void;
  onGlobalControlsChange?: (
    globalControls: DashboardInterface["globalControls"],
    blocks?: DashboardBlockInterfaceOrData<DashboardBlockInterface>[],
  ) => Promise<void>;
  dashboardComparison?: DashboardInterface["comparison"];
  onDashboardComparisonChange?: (
    comparison: DashboardInterface["comparison"],
  ) => Promise<void>;
  updateTemporaryDashboardResults?: (
    globalControls?: DashboardInterface["globalControls"],
    blocks?: DashboardBlockInterfaceOrData<DashboardBlockInterface>[],
  ) => Promise<void>;
  switchToExperimentView?: () => void;
  isGeneralDashboard: boolean;
  setIsEditing?: (v: boolean) => void;
  enterEditModeForBlock?: (blockIndex: number) => void;
  editBlockProps?: EditBlockProps;
}

function DashboardEditor({
  isTabActive,
  title,
  blocks,
  globalControlBlocks,
  isEditing,
  enableAutoUpdates,
  updateSchedule,
  globalControls,
  ownerId,
  initialEditLevel,
  initialShareLevel,
  id,
  dashboardOwnerId,
  nextUpdate,
  dashboardLastUpdated,
  projects,
  setBlock,
  mutate,
  onGlobalControlsChange,
  dashboardComparison,
  onDashboardComparisonChange,
  updateTemporaryDashboardResults,
  switchToExperimentView,
  isGeneralDashboard = false,
  setIsEditing,
  enterEditModeForBlock,
  editBlockProps,
}: Props) {
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
  } = editBlockProps ?? {};

  const [editDashboard, setEditDashboard] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [duplicateDashboard, setDuplicateDashboard] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [queriesModalOpen, setQueriesModalOpen] = useState(false);
  const [needsUpdate, setNeedsUpdate] = useState(false);
  const { apiCall } = useAuth();
  const { userId } = useUser();
  const permissionsUtil = usePermissionsUtil();
  const { allQueries, savedQueriesMap, snapshotError } = useContext(
    DashboardSnapshotContext,
  );
  const isOwner = dashboardOwnerId === userId;
  const isAdmin = permissionsUtil.canManageOrgSettings();
  let canEdit = permissionsUtil.canUpdateGeneralDashboards(
    { projects: projects || [] },
    {},
  );
  const canDelete =
    permissionsUtil.canDeleteGeneralDashboards({
      projects: projects || [],
    }) &&
    (isOwner || isAdmin);
  const canDuplicate = permissionsUtil.canCreateGeneralDashboards({
    projects: projects || [],
  });
  const canManageSharingAndEditLevels = canEdit && (isOwner || isAdmin);

  if (initialEditLevel === "private" && !isOwner && !isAdmin) {
    canEdit = false;
  }
  const savedQueryIds = [...savedQueriesMap.keys()];
  const queryStrings = useMemo(() => {
    return allQueries.map((q) => q.query) ?? [];
  }, [allQueries]);

  const error = snapshotError;
  const count = queryStrings.length + savedQueryIds.length;
  const handleViewQueries = () => {
    setQueriesModalOpen(true);
    setDropdownOpen(false);
  };

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
      />
    );
  };

  return (
    <DashboardChartsProvider>
      {editDashboard && (
        <DashboardModal
          mode="edit"
          type={isGeneralDashboard ? "general" : "experiment"}
          initial={{
            title: title,
            editLevel: initialEditLevel,
            enableAutoUpdates: enableAutoUpdates,
            updateSchedule: updateSchedule || undefined,
            shareLevel: initialShareLevel,
            projects: projects,
            userId: ownerId,
          }}
          close={() => setEditDashboard(false)}
          submit={async (data) => {
            await apiCall(`/dashboards/${id}`, {
              method: "PUT",
              body: JSON.stringify(data),
            });
            mutate();
          }}
        />
      )}
      {duplicateDashboard && (
        <DashboardModal
          mode="duplicate"
          type={isGeneralDashboard ? "general" : "experiment"}
          initial={{
            title: `Copy of ${title}`,
            editLevel: initialEditLevel,
            enableAutoUpdates: enableAutoUpdates,
            updateSchedule: updateSchedule || undefined,
            shareLevel: initialShareLevel,
            projects,
            userId: ownerId,
            blocks,
          }}
          close={() => setDuplicateDashboard(false)}
          submit={async (data) => {
            const res = await apiCall<{
              status: number;
              dashboard: DashboardInterface;
            }>(`/dashboards`, {
              method: "POST",
              body: JSON.stringify({
                title: data.title,
                editLevel: data.editLevel,
                shareLevel: data.shareLevel,
                enableAutoUpdates: data.enableAutoUpdates,
                experimentId: "",
                updateSchedule: data.updateSchedule,
                projects: data.projects,
                globalControls,
                blocks: (data.blocks ?? []).map(getBlockData),
              }),
            });
            if (res.status === 200) {
              if (typeof window !== "undefined") {
                window.location.href = `/product-analytics/dashboards/${res.dashboard.id}`;
              }
            } else {
              console.error(res);
            }
          }}
        />
      )}
      <DashboardShareModal
        isOpen={shareModalOpen}
        onClose={() => setShareModalOpen(false)}
        onSubmit={async (data) => {
          await apiCall(`/dashboards/${id}`, {
            method: "PUT",
            body: JSON.stringify({
              shareLevel: data.shareLevel,
              editLevel: data.editLevel,
            }),
          });
          await mutate();
        }}
        initialValues={{
          shareLevel: initialShareLevel,
          editLevel: initialEditLevel,
        }}
        isGeneralDashboard={isGeneralDashboard}
        dashboardId={id}
      />
      <Box mt={isEditing ? "1" : undefined} mb="3">
        <Flex align="center" height={DASHBOARD_TOPBAR_HEIGHT} gap="1">
          {switchToExperimentView ? (
            <Button variant="ghost" size="xs" onClick={switchToExperimentView}>
              View Regular Experiment View
            </Button>
          ) : (
            <Flex align="center" gap="2" flexGrow="1" minWidth="0">
              <Text truncate={true} size="x-large">
                {title}
              </Text>
              <ShareStatusBadge
                shareLevel={
                  initialShareLevel === "published" ? "organization" : "private"
                }
                editLevel={
                  initialEditLevel === "private" ? "private" : "organization"
                }
                isOwner={dashboardOwnerId === userId}
              />
            </Flex>
          )}
          <DashboardUpdateDisplay
            dashboardId={id}
            enableAutoUpdates={enableAutoUpdates}
            nextUpdate={nextUpdate}
            dashboardLastUpdated={dashboardLastUpdated}
            disabled={!!editSidebarDirty}
            isEditing={isEditing}
            needsUpdate={needsUpdate}
            updateTemporaryDashboardResults={updateTemporaryDashboardResults}
            onUpdated={() => setNeedsUpdate(false)}
          />
          {isGeneralDashboard && setIsEditing && !isEditing ? (
            <Flex align="center" gap="4" ml="4" flexShrink="0">
              {canManageSharingAndEditLevels && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShareModalOpen(true)}
                >
                  Share...
                </Button>
              )}
              <Button
                variant="solid"
                size="sm"
                disabled={!canEdit}
                onClick={() => setIsEditing(true)}
              >
                <PiPencilSimpleFill className="mr-2" />
                Edit Blocks
              </Button>

              <DropdownMenu
                trigger={
                  <IconButton
                    variant="ghost"
                    color="gray"
                    radius="full"
                    size="3"
                    highContrast
                  >
                    <BsThreeDotsVertical size={18} />
                  </IconButton>
                }
                open={dropdownOpen}
                onOpenChange={(o) => {
                  setDropdownOpen(!!o);
                }}
                menuPlacement="end"
                variant="soft"
              >
                <DropdownMenuGroup>
                  {canEdit && (
                    <DropdownMenuItem
                      onClick={() => {
                        setEditDashboard(true);
                        setDropdownOpen(false);
                      }}
                    >
                      Edit Dashboard Settings
                    </DropdownMenuItem>
                  )}
                  {canDuplicate && (
                    <DropdownMenuItem
                      onClick={() => {
                        setDuplicateDashboard(true);
                        setDropdownOpen(false);
                      }}
                    >
                      Duplicate
                    </DropdownMenuItem>
                  )}
                  {queryStrings.length > 0 || savedQueryIds.length > 0 ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={handleViewQueries}>
                        View queries
                        <Badge
                          variant="soft"
                          radius="full"
                          label={String(count)}
                          ml="2"
                          color={error ? "red" : undefined}
                        />
                      </DropdownMenuItem>
                    </>
                  ) : null}
                  {canDelete && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        color="red"
                        confirmation={{
                          confirmationTitle: "Delete Dashboard?",
                          cta: "Delete",
                          submit: async () => {
                            await apiCall(`/dashboards/${id}`, {
                              method: "DELETE",
                            });
                            if (typeof window !== "undefined") {
                              window.location.href =
                                "/product-analytics/dashboards";
                            }
                          },
                          closeDropdown: () => {
                            setDropdownOpen(false);
                          },
                        }}
                      >
                        Delete
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuGroup>
              </DropdownMenu>
              {queriesModalOpen &&
                (queryStrings.length > 0 || savedQueryIds.length > 0) && (
                  <AsyncQueriesModal
                    close={() => setQueriesModalOpen(false)}
                    queries={queryStrings}
                    savedQueries={savedQueryIds}
                    error={error}
                  />
                )}
            </Flex>
          ) : null}
        </Flex>
        {!isEditing && (
          <Flex align="center" gap="3">
            <Flex align="center" gap="1">
              <Text weight="medium">Projects:</Text>
              {projects?.length ? (
                <Tooltip
                  body={
                    <Flex direction="column" gap="1">
                      <ProjectBadges
                        skipMargin
                        resourceType="dashboard"
                        projectIds={projects}
                      />
                    </Flex>
                  }
                >
                  <span role="button">{projects.length}</span>
                </Tooltip>
              ) : (
                <ProjectBadges resourceType="dashboard" />
              )}
            </Flex>
            <Flex align="center" gap="1">
              <Text weight="medium">Owner:</Text>
              <Owner ownerId={dashboardOwnerId} gap="1" />
            </Flex>
          </Flex>
        )}
        {isGeneralDashboard && onGlobalControlsChange ? (
          <DashboardGlobalControlsBar
            blocks={globalControlBlocks ?? blocks}
            globalControls={globalControls}
            canEdit={canEdit}
            onGlobalControlsChange={onGlobalControlsChange}
            dashboardComparison={dashboardComparison}
            onDashboardComparisonChange={onDashboardComparisonChange}
            updateTemporaryDashboardResults={updateTemporaryDashboardResults}
            setNeedsUpdate={setNeedsUpdate}
          />
        ) : null}
      </Box>
      <div>
        {blocks.length === 0 ? (
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
              <Heading as="h1" size="large" weight="medium" align="center">
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
                    size="sm"
                    icon={<PiCaretDownFill />}
                    iconPosition="right"
                  >
                    Add Block
                  </Button>
                }
              />
            ) : canEdit && setIsEditing ? (
              <Button size="md" onClick={() => setIsEditing(true)}>
                Add Block
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
                  size="sm"
                  variant="outline"
                  icon={<PiCaretDownFill />}
                  iconPosition="right"
                >
                  Add Block
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
      // useContainerWidth gives back React 19's `RefObject<T | null>` but the
      // codebase is still on React 18 types - cast to satisfy the older
      // LegacyRef signature without changing runtime behaviour.
      ref={containerRef as unknown as React.RefObject<HTMLDivElement>}
      className={clsx("dashboard-grid-container", { "is-editing": isEditing })}
    >
      {mounted && (
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

export default withErrorBoundary(DashboardEditor, {
  fallback: <Callout status="error">Failed to load dashboard</Callout>,
});
