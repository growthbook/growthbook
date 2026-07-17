import { Box, Flex, IconButton } from "@radix-ui/themes";
import {
  DashboardBlockInterfaceOrData,
  DashboardBlockInterface,
  DashboardBlockType,
  DashboardInterface,
  dashboardBlockHasIds,
} from "shared/enterprise";
import React, { useMemo, useState } from "react";
import { useGrowthBook } from "@growthbook/growthbook-react";
import { AppFeatures } from "shared/types/app-features";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { isDefined } from "shared/util";
import { PiDotsThreeVertical, PiPlusCircle } from "react-icons/pi";
import Tooltip from "@/components/Tooltip/Tooltip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/Tabs";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenu,
} from "@/ui/DropdownMenu";
import Avatar from "@/ui/Avatar";
import {
  DASHBOARD_WORKSPACE_NAV_BOTTOM_PADDING,
  DASHBOARD_WORKSPACE_NAV_HEIGHT,
} from "@/enterprise/components/Dashboards/DashboardWorkspace";
import Button from "@/ui/Button";
import {
  BLOCK_SUBGROUPS,
  BLOCK_TYPE_INFO,
  isBlockTypeAllowed,
} from "@/enterprise/components/Dashboards/DashboardEditor";
import Text from "@/ui/Text";
import EditSingleBlock from "./EditSingleBlock";

// Block types that are allowed in general dashboards (non-experiment specific)
const GENERAL_DASHBOARD_BLOCK_TYPES: DashboardBlockType[] = [
  "markdown",
  "metric-exploration",
  "metric-experiments",
  "experiments-scaled-impact",
  "experiments-win-rate",
  "experiments-status",
  "fact-table-exploration",
  "data-source-exploration",
  "funnel-exploration",
  "sql-explorer",
  "metric-explorer",
];

function moveBlocks<T>(
  blocks: Array<T>,
  draggingBlockIndex: number,
  dropLocation: number,
) {
  const otherBlocks = blocks.toSpliced(draggingBlockIndex, 1);
  return [
    ...otherBlocks.slice(0, dropLocation),
    blocks[draggingBlockIndex],
    ...otherBlocks.slice(dropLocation),
  ];
}

function BlockTypePopoverContent({
  blockType,
}: {
  blockType: DashboardBlockType;
}) {
  const blockInfo = BLOCK_TYPE_INFO[blockType];

  return (
    <Flex direction="column" gap="3" style={{ width: 300 }}>
      <Flex align="center" gap="2">
        <Avatar radius="small" color="indigo" variant="soft" size="sm">
          {blockInfo.icon}
        </Avatar>
        <Text size="large" weight="semibold" color="text-high">
          {blockInfo.name}
        </Text>
      </Flex>
      <Text as="div" size="medium" color="text-mid">
        {blockInfo.description}
      </Text>
    </Flex>
  );
}

interface Props {
  dashboardId: string;
  projects: string[];
  experiment: ExperimentInterfaceStringDates | null;
  isGeneralDashboard?: boolean;
  dashboardGlobalControls?: DashboardInterface["globalControls"];
  open: boolean;
  cancel: () => void;
  submit: () => void;
  blocks: DashboardBlockInterfaceOrData<DashboardBlockInterface>[];
  stagedBlock:
    | DashboardBlockInterfaceOrData<DashboardBlockInterface>
    | undefined;
  setBlocks: React.Dispatch<
    DashboardBlockInterfaceOrData<DashboardBlockInterface>[]
  >;
  setStagedBlock: React.Dispatch<
    DashboardBlockInterfaceOrData<DashboardBlockInterface> | undefined
  >;
  addBlockType: (bType: DashboardBlockType, i?: number) => void;
  focusBlock: (index: number) => void;
  editBlock: (index: number) => void;
  duplicateBlock: (index: number) => void;
  deleteBlock: (index: number) => void;
}

export default function DashboardEditorSidebar({
  projects,
  dashboardId,
  experiment,
  isGeneralDashboard = false,
  dashboardGlobalControls,
  open,
  cancel,
  submit,
  blocks,
  stagedBlock,
  setBlocks,
  setStagedBlock,
  addBlockType,
  focusBlock,
  editBlock,
  duplicateBlock,
  deleteBlock,
}: Props) {
  const gb = useGrowthBook<AppFeatures>();
  const funnelExplorerEnabled = !!gb?.isOn("product-analytics-funnels");
  const [draggingBlockIndex, setDraggingBlockIndex] = useState<
    number | undefined
  >(undefined);
  const [previewBlockPlacement, setPreviewBlockPlacement] = useState<
    number | undefined
  >(undefined);

  const resetDragState = () => {
    setDraggingBlockIndex(undefined);
    setPreviewBlockPlacement(undefined);
  };

  const onDrop = (dropLocation: number) => {
    if (!isDefined(draggingBlockIndex) || draggingBlockIndex === dropLocation)
      return;
    setBlocks(moveBlocks(blocks, draggingBlockIndex, dropLocation));
    resetDragState();
  };

  const displayBlocks = useMemo(() => {
    if (!isDefined(draggingBlockIndex) || !isDefined(previewBlockPlacement))
      return blocks;
    return moveBlocks(blocks, draggingBlockIndex, previewBlockPlacement);
  }, [blocks, draggingBlockIndex, previewBlockPlacement]);

  const blockNavigatorEnabled = false;

  const addBlocksContent = (
    <Flex direction="column" align="start" px="4" pb="4" pt="2" gap="5">
      {BLOCK_SUBGROUPS.map(([subgroup, blockTypes], i) => {
        // Filter block types based on dashboard type
        const allowedBlockTypes = blockTypes.filter((bType) =>
          isBlockTypeAllowed(bType, isGeneralDashboard, funnelExplorerEnabled),
        );

        // Don't render the subgroup if no block types are allowed
        if (allowedBlockTypes.length === 0) {
          return null;
        }

        return (
          <Flex
            direction="column"
            gap="2"
            align="start"
            key={`${subgroup}-${i}`}
            width="100%"
          >
            <Text
              weight="medium"
              size="small"
              color="text-high"
              textTransform="uppercase"
            >
              {subgroup}
            </Text>

            {allowedBlockTypes.map((bType) => {
              if (BLOCK_TYPE_INFO[bType].deprecated) {
                return null;
              }
              return (
                <Tooltip
                  key={bType}
                  body={<BlockTypePopoverContent blockType={bType} />}
                  tipPosition="left"
                  tipMinWidth="300px"
                  usePortal
                  flipTheme={false}
                  style={{ display: "block", width: "100%" }}
                >
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      addBlockType(bType);
                    }}
                    style={{
                      display: "block",
                      padding: "5px",
                      margin: "0 -5px",
                      width: "100%",
                      borderRadius: "6px",
                    }}
                    className="hover-show no-underline hover-border-violet"
                  >
                    <Flex align="center">
                      <Avatar
                        radius="small"
                        color="indigo"
                        variant="soft"
                        mr="2"
                        size="sm"
                      >
                        {BLOCK_TYPE_INFO[bType].icon}
                      </Avatar>
                      <Text size="medium" weight="regular" color="text-high">
                        {BLOCK_TYPE_INFO[bType].name}
                      </Text>
                      <div style={{ flex: 1 }} />
                      <span
                        style={{ color: "var(--violet-11)" }}
                        className="ml-auto show-target instant"
                      >
                        <PiPlusCircle /> Add
                      </span>
                    </Flex>
                  </a>
                </Tooltip>
              );
            })}
          </Flex>
        );
      })}
    </Flex>
  );

  return (
    <div
      id="edit-drawer"
      className="mt-3"
      style={{
        width: open ? 480 : 40, // 440 + 40 gutter
        height: `calc(100vh - (${DASHBOARD_WORKSPACE_NAV_HEIGHT} + ${DASHBOARD_WORKSPACE_NAV_BOTTOM_PADDING}))`,
        marginRight: -40,
        transition: "width 0.5s cubic-bezier(0.685, 0.0473, 0.346, 1)",
        position: "relative",
        zIndex: 9001,
        overflow: "hidden",
      }}
    >
      <div
        className="appbox"
        style={{
          width: "440px",
          maxHeight: `calc(100% - ${DASHBOARD_WORKSPACE_NAV_BOTTOM_PADDING})`,
          position: "absolute",
          left: 0,
          top: 0,
          opacity: open ? 1 : 0,
          transition: "opacity 0.4s",
          overflowX: "hidden",
          overflowY: "auto",
        }}
      >
        {isDefined(stagedBlock) ? (
          // Only render EditSingleBlock if we have an experiment or if it's a general dashboard block
          experiment ||
          GENERAL_DASHBOARD_BLOCK_TYPES.includes(stagedBlock.type) ? (
            <EditSingleBlock
              dashboardId={dashboardId}
              experiment={experiment}
              projects={projects}
              dashboardGlobalControls={dashboardGlobalControls}
              cancel={cancel}
              submit={submit}
              block={stagedBlock}
              setBlock={setStagedBlock}
            />
          ) : (
            <div style={{ width: "440px", padding: "20px" }}>
              <Text>This block type requires an experiment to edit.</Text>
              <Button onClick={cancel} style={{ marginTop: "10px" }}>
                Cancel
              </Button>
            </div>
          )
        ) : !blockNavigatorEnabled ? (
          <div style={{ width: "440px" }}>
            <Box px="4" pt="4">
              <Text size="large" weight="semibold">
                Add a Block
              </Text>
            </Box>
            {addBlocksContent}
          </div>
        ) : (
          <Tabs defaultValue="add-block" style={{ width: "440px" }}>
            <TabsList>
              <TabsTrigger value="add-block">Add Block</TabsTrigger>
              <TabsTrigger value="block-navigator">Block Navigator</TabsTrigger>
            </TabsList>
            <TabsContent value="add-block">{addBlocksContent}</TabsContent>
            <TabsContent value="block-navigator">
              <Flex direction="column" align="start" p="2">
                <Text color="text-mid" my="3">
                  Drag to reorder blocks. Click to bring block into focus.
                </Text>
                {displayBlocks.map((block, i) => (
                  <Flex
                    width="100%"
                    justify="between"
                    key={dashboardBlockHasIds(block) ? block.id : i}
                    my="2"
                    onClick={() => focusBlock(i)}
                    className="hover-border-violet"
                    align="center"
                    p="1"
                    style={{ cursor: "pointer" }}
                    draggable={true}
                    onDragStart={() => setDraggingBlockIndex(i)}
                    onDragEnd={() => resetDragState()}
                    onDrop={() => onDrop(i)}
                    onDragOver={(e) => e.preventDefault()}
                    onDragEnter={(e) => {
                      if (!isDefined(draggingBlockIndex)) return;
                      if (draggingBlockIndex === i) {
                        setPreviewBlockPlacement(undefined);
                        return;
                      }
                      setPreviewBlockPlacement(i);
                      e.preventDefault();
                    }}
                  >
                    {/* TODO: icon */}
                    <Text>{BLOCK_TYPE_INFO[block.type].name}</Text>

                    <DropdownMenu
                      trigger={
                        <IconButton variant="ghost" size="1">
                          <PiDotsThreeVertical />
                        </IconButton>
                      }
                    >
                      <DropdownMenuItem
                        onClick={() => {
                          editBlock(i);
                        }}
                      >
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => {
                          duplicateBlock(i);
                        }}
                      >
                        Duplicate
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => {
                          deleteBlock(i);
                        }}
                      >
                        <span style={{ color: "var(--red-11)" }}>Delete</span>
                      </DropdownMenuItem>
                    </DropdownMenu>
                  </Flex>
                ))}
              </Flex>
            </TabsContent>
          </Tabs>
        )}
      </div>
    </div>
  );
}
