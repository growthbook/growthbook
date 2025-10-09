import React, { Fragment, ReactElement, useEffect, useState } from "react";
import {
  PiCaretDownFill,
  PiPlus,
  PiTableDuotone,
  PiChartLineDuotone,
  PiFileSqlDuotone,
  PiListDashesDuotone,
  PiArticleMediumDuotone,
  PiPencilSimpleFill,
} from "react-icons/pi";
import {
  DashboardBlockInterfaceOrData,
  DashboardBlockInterface,
  DashboardBlockType,
} from "back-end/src/enterprise/validators/dashboard-block";
import { isDefined } from "shared/util";
import { Container, Flex, Heading, IconButton, Text } from "@radix-ui/themes";
import clsx from "clsx";
import { withErrorBoundary } from "@sentry/react";
import { isPersistedDashboardBlock } from "shared/enterprise";
import { BsThreeDotsVertical } from "react-icons/bs";
import {
  DashboardEditLevel,
  DashboardInterface,
} from "back-end/src/enterprise/validators/dashboard";
import Button from "@/ui/Button";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";
import Callout from "@/ui/Callout";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useAuth } from "@/services/auth";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useUser } from "@/services/UserContext";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import DashboardModal from "../DashboardModal";
import DashboardBlock from "./DashboardBlock";
import DashboardUpdateDisplay from "./DashboardUpdateDisplay";
import DashboardViewQueriesButton from "./DashboardViewQueriesButton";

export const DASHBOARD_TOPBAR_HEIGHT = "40px";
export const BLOCK_TYPE_INFO: Record<
  DashboardBlockType,
  { name: string; icon: ReactElement }
> = {
  markdown: {
    name: "Markdown",
    icon: <PiArticleMediumDuotone />,
  },
  "experiment-metadata": {
    name: "Experiment Metadata",
    icon: <PiListDashesDuotone />,
  },
  "experiment-metric": {
    name: "Metric Results",
    icon: <PiTableDuotone />,
  },
  "experiment-dimension": {
    name: "Dimension Results",
    icon: <PiTableDuotone />,
  },
  "experiment-time-series": {
    name: "Time Series",
    icon: <PiChartLineDuotone />,
  },
  "experiment-traffic": {
    name: "Experiment Traffic",
    icon: <PiChartLineDuotone />,
  },
  "sql-explorer": {
    name: "SQL Explorer",
    icon: <PiFileSqlDuotone />,
  },
  "metric-explorer": {
    name: "Metric Explorer",
    icon: <PiFileSqlDuotone />,
  },
};

export const BLOCK_SUBGROUPS: [string, DashboardBlockType[]][] = [
  [
    "Metric Results",
    ["experiment-metric", "experiment-dimension", "experiment-time-series"],
  ],
  ["Experiment Info", ["experiment-metadata", "experiment-traffic"]],
  ["Other", ["markdown", "sql-explorer", "metric-explorer"]],
];

// Block types that are allowed in general dashboards (non-experiment specific)
const GENERAL_DASHBOARD_BLOCK_TYPES: DashboardBlockType[] = [
  "markdown",
  "sql-explorer",
  "metric-explorer",
];

// Helper function to check if a block type is allowed for the given dashboard type
const isBlockTypeAllowed = (
  blockType: DashboardBlockType,
  isGeneralDashboard: boolean,
): boolean => {
  if (isGeneralDashboard) {
    return GENERAL_DASHBOARD_BLOCK_TYPES.includes(blockType);
  } else {
    return true; // All block types are allowed for experiment dashboards
  }
};

function AddBlockDropdown({
  trigger,
  addBlockType,
  onDropdownOpen,
  onDropdownClose,
  isGeneralDashboard = false,
}: {
  trigger: React.ReactNode;
  addBlockType: (bType: DashboardBlockType) => void;
  onDropdownOpen?: () => void;
  onDropdownClose?: () => void;
  isGeneralDashboard?: boolean;
}) {
  const [dropdownOpen, setDropdownOpen] = useState<boolean>(false);
  useEffect(() => {
    if (dropdownOpen) {
      onDropdownOpen && onDropdownOpen();
    } else {
      onDropdownClose && onDropdownClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dropdownOpen]);

  return (
    <DropdownMenu
      variant="solid"
      open={dropdownOpen}
      onOpenChange={(o) => {
        setDropdownOpen(!!o);
      }}
      trigger={trigger}
    >
      {BLOCK_SUBGROUPS.map(([subgroup, blockTypes], i) => {
        // Filter block types based on dashboard type
        const allowedBlockTypes = blockTypes.filter((bType) =>
          isBlockTypeAllowed(bType, isGeneralDashboard),
        );

        // Don't render the subgroup if no block types are allowed
        if (allowedBlockTypes.length === 0) {
          return null;
        }

        return (
          <Fragment key={`${subgroup}-${i}`}>
            <DropdownMenuLabel className="font-weight-bold">
              <Text style={{ color: "var(--color-text-high)" }}>
                {subgroup}
              </Text>
            </DropdownMenuLabel>
            {allowedBlockTypes.map((bType) => (
              <DropdownMenuItem
                key={bType}
                onClick={() => {
                  setDropdownOpen(false);
                  addBlockType(bType);
                }}
              >
                {BLOCK_TYPE_INFO[bType].name}
              </DropdownMenuItem>
            ))}
            {i < BLOCK_SUBGROUPS.length - 1 && <DropdownMenuSeparator />}
          </Fragment>
        );
      })}
    </DropdownMenu>
  );
}

interface Props {
  isTabActive: boolean;
  title: string;
  blocks: DashboardBlockInterfaceOrData<DashboardBlockInterface>[];
  id: string;
  isEditing: boolean;
  projects: string[];
  enableAutoUpdates: boolean;
  editLevel: DashboardEditLevel;
  dashboardOwnerId: string;
  nextUpdate: Date | undefined;
  dashboardLastUpdated?: Date;
  editSidebarDirty: boolean;
  focusedBlockIndex: number | undefined;
  stagedBlockIndex: number | undefined;
  scrollAreaRef: null | React.MutableRefObject<HTMLDivElement | null>;
  setBlock: (
    index: number,
    block: DashboardBlockInterfaceOrData<DashboardBlockInterface>,
  ) => void;
  moveBlock: (index: number, direction: -1 | 1) => void;
  addBlockType: (bType: DashboardBlockType, i?: number) => void;
  editBlock: (index: number) => void;
  duplicateBlock: (index: number) => void;
  deleteBlock: (index: number) => void;
  mutate: () => void;
  switchToExperimentView?: () => void;
  isGeneralDashboard: boolean;
  setIsEditing?: (v: boolean) => void;
}

function DashboardEditor({
  isTabActive,
  title,
  blocks,
  isEditing,
  enableAutoUpdates,
  editLevel,
  id,
  dashboardOwnerId,
  nextUpdate,
  dashboardLastUpdated,
  projects,
  editSidebarDirty,
  focusedBlockIndex,
  stagedBlockIndex,
  scrollAreaRef,
  setBlock,
  moveBlock,
  addBlockType,
  editBlock,
  duplicateBlock,
  deleteBlock,
  mutate,
  switchToExperimentView,
  isGeneralDashboard = false,
  setIsEditing,
}: Props) {
  const [editDashboard, setEditDashboard] = useState(false);
  const { apiCall } = useAuth();
  const { userId, hasCommercialFeature } = useUser();
  const permissionsUtil = usePermissionsUtil();
  let canEdit = permissionsUtil.canUpdateGeneralDashboards(
    { projects: projects || [] },
    {},
  );
  let canDelete = permissionsUtil.canDeleteGeneralDashboards({
    projects: projects || [],
  });
  if (editLevel === "private" && dashboardOwnerId !== userId) {
    canEdit = false;
    canDelete = false;
  }

  const { performCopy, copySuccess } = useCopyToClipboard({
    timeout: 1500,
  });

  const handleDuplicate = async () => {
    // Clean blocks by removing system-generated properties
    const cleanBlocks = blocks.map((block) => {
      // Check if block has the system properties and remove them
      if ("organization" in block || "id" in block || "uid" in block) {
        const {
          organization: _organization,
          id: _id,
          uid: _uid,
          ...cleanBlock
        } = block as Record<string, unknown>;
        return cleanBlock;
      }
      return block;
    });
    const res = await apiCall<{
      status: number;
      dashboard: DashboardInterface;
    }>(`/dashboards`, {
      method: "POST",
      body: JSON.stringify({
        blocks: cleanBlocks,
        title: `${title} (Copy)`,
        editLevel:
          editLevel === "organization" &&
          !hasCommercialFeature("share-product-analytics-dashboards")
            ? "private"
            : editLevel,
        enableAutoUpdates,
        experimentId: "",
        projects,
      }),
    });
    if (res.status === 200) {
      mutate();
      // I think we should route the user to the new dashboard
      if (typeof window !== "undefined") {
        window.location.href = `/dashboards/${res.dashboard.id}`;
      }
    } else {
      console.error(res);
    }
  };

  const renderSingleBlock = ({
    i,
    key,
    block,
    isFocused,
    setBlock,
    isEditingBlock,
    isLastBlock,
  }: {
    i: number;
    key: number | string;
    block: DashboardBlockInterfaceOrData<DashboardBlockInterface>;
    isFocused: boolean;
    setBlock: React.Dispatch<
      DashboardBlockInterfaceOrData<DashboardBlockInterface>
    >;
    isEditingBlock: boolean;
    isLastBlock: boolean;
  }) => {
    return (
      <Flex direction="column" key={key}>
        <DashboardBlock
          isTabActive={isTabActive}
          block={block}
          isEditing={isEditing}
          isFocused={isFocused}
          editingBlock={isEditingBlock}
          disableBlock={
            editSidebarDirty && !isEditingBlock
              ? "full"
              : isDefined(stagedBlockIndex)
                ? "partial"
                : "none"
          }
          isFirstBlock={i === 0}
          isLastBlock={i === blocks.length - 1}
          scrollAreaRef={scrollAreaRef}
          setBlock={setBlock}
          editBlock={() => editBlock(i)}
          duplicateBlock={() => duplicateBlock(i)}
          deleteBlock={() => deleteBlock(i)}
          moveBlock={(direction) => moveBlock(i, direction)}
          mutate={mutate}
        />
        <Container
          py="2px"
          className={clsx({
            "dashboard-disabled": editSidebarDirty,
          })}
          mb={!isEditing ? "4" : "0"}
        >
          {isEditing && (
            <Flex
              justify="center"
              position="relative"
              mt={isLastBlock ? "2" : "0"}
              className="hover-show"
              style={!editSidebarDirty ? {} : { visibility: "hidden" }}
            >
              {isDefined(i) && (
                <div
                  style={{
                    pointerEvents: "none",
                    position: "absolute",
                    top: "0",
                    width: "100%",
                    height: "50%",
                    borderBottom: "1px solid var(--violet-a9)",
                  }}
                  className={"show-target"}
                />
              )}
              <AddBlockDropdown
                trigger={
                  <IconButton
                    className={isLastBlock ? "" : "show-target"}
                    size="1"
                    style={{ zIndex: 10 }}
                  >
                    <Flex height="16px" align="center">
                      <PiPlus size="10" />
                    </Flex>
                  </IconButton>
                }
                addBlockType={(bType: DashboardBlockType) => {
                  if (isDefined(i)) {
                    addBlockType(bType, i + 1);
                  }
                }}
                isGeneralDashboard={isGeneralDashboard}
              />
            </Flex>
          )}
        </Container>
      </Flex>
    );
  };

  return (
    <div>
      {editDashboard && (
        <DashboardModal
          mode="edit"
          initial={{
            title: title,
            editLevel: editLevel,
            enableAutoUpdates: enableAutoUpdates,
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
      <Flex
        align="center"
        height={DASHBOARD_TOPBAR_HEIGHT}
        className="mb-3"
        gap="1"
      >
        {switchToExperimentView ? (
          <Button variant="ghost" size="xs" onClick={switchToExperimentView}>
            View Regular Experiment View
          </Button>
        ) : (
          <Text
            weight="medium"
            size="5"
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              flexShrink: 1,
            }}
          >
            {title}
          </Text>
        )}
        <div style={{ flexGrow: 1 }} />
        <DashboardUpdateDisplay
          enableAutoUpdates={enableAutoUpdates}
          nextUpdate={nextUpdate}
          dashboardLastUpdated={dashboardLastUpdated}
          disabled={editSidebarDirty}
          isEditing={isEditing}
        />
        {isGeneralDashboard && setIsEditing && !isEditing ? (
          <>
            <Tooltip
              state={copySuccess}
              ignoreMouseEvents
              delay={0}
              tipPosition="left"
              body="URL copied to clipboard"
              innerClassName="px-2 py-1"
            >
              <Button
                variant="outline"
                size="sm"
                style={{ whiteSpace: "nowrap" }}
                onClick={() => {
                  const url = window.location.href.replace(
                    /[?#].*/,
                    `#dashboards/${id}`,
                  );
                  performCopy(url);
                }}
              >
                Copy link
              </Button>
            </Tooltip>
            <Button
              variant="solid"
              size="sm"
              className="mx-4"
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
                  <BsThreeDotsVertical />
                </IconButton>
              }
            >
              <DropdownMenuItem
                disabled={!canEdit}
                onClick={() => setEditDashboard(true)}
              >
                Edit Details
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleDuplicate()}>
                Duplicate
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DashboardViewQueriesButton
                className="dropdown-item text-capitalize"
                weight="regular"
                size="2"
              />
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={!canDelete}
                onClick={async () => {
                  await apiCall(`/dashboards/${id}`, {
                    method: "DELETE",
                  });
                  if (typeof window !== "undefined") {
                    window.location.href = "/dashboards";
                  }
                }}
                color="red"
              >
                Delete
              </DropdownMenuItem>
            </DropdownMenu>
          </>
        ) : null}
      </Flex>
      <div>
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
                <Heading weight="medium" align="center">
                  Add Content Blocks
                </Heading>
                <Text align="center">Choose a block type to get started.</Text>
              </Flex>
              <AddBlockDropdown
                addBlockType={addBlockType}
                isGeneralDashboard={isGeneralDashboard}
                trigger={
                  <Button
                    size="sm"
                    icon={<PiCaretDownFill />}
                    iconPosition="right"
                  >
                    Add block
                  </Button>
                }
              />
            </Flex>
          ) : (
            blocks.map((block, i) =>
              renderSingleBlock({
                i,
                key: isPersistedDashboardBlock(block)
                  ? block.id
                  : `${block.type}-${i}`,
                block: block,
                isFocused: focusedBlockIndex === i,
                setBlock: (block) => setBlock(i, block),
                isEditingBlock: stagedBlockIndex === i,
                isLastBlock: i === blocks.length - 1,
              }),
            )
          )}
          {/* Add padding at the bottom so there's room to scroll the selected block to the middle/top of the page */}
          {isEditing && <div style={{ height: 350 }} />}
        </div>
      </div>
    </div>
  );
}

export default withErrorBoundary(DashboardEditor, {
  fallback: <Callout status="error">Failed to load dashboard</Callout>,
});
