import React, { useContext, useMemo, useState } from "react";
import { PiCaretDownFill, PiPencilSimpleFill } from "react-icons/pi";
import { BsThreeDotsVertical } from "react-icons/bs";
import {
  DashboardBlockInterfaceOrData,
  DashboardBlockInterface,
  DashboardBlockType,
  getBlockData,
  DashboardEditLevel,
  DashboardInterface,
  DashboardShareLevel,
  DashboardUpdateSchedule,
} from "shared/enterprise";
import { isDefined } from "shared/util";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import clsx from "clsx";
import { withErrorBoundary } from "@sentry/nextjs";
import { LayoutItem } from "react-grid-layout";
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
import { AddBlockOptions } from "./dashboardLayout";
import DashboardGrid from "./DashboardGrid";

export const DASHBOARD_TOPBAR_HEIGHT = "40px";

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
            <Button variant="ghost" size="sm" onClick={switchToExperimentView}>
              View Regular Experiment View
            </Button>
          ) : (
            <Flex align="center" gap="2" flexGrow="1" minWidth="0">
              <Text truncate={true} size="xl">
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
                  size="md"
                  onClick={() => setShareModalOpen(true)}
                >
                  Share...
                </Button>
              )}
              <Button
                variant="solid"
                size="md"
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
                    Add Block
                  </Button>
                }
              />
            ) : canEdit && setIsEditing ? (
              <Button size="lg" onClick={() => setIsEditing(true)}>
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
                  size="md"
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

export default withErrorBoundary(DashboardEditor, {
  fallback: <Callout status="error">Failed to load dashboard</Callout>,
});
