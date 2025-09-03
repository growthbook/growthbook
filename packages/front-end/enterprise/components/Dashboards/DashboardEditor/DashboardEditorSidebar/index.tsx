import { Box, Flex, IconButton, Text } from "@radix-ui/themes";
import {
  DashboardBlockInterfaceOrData,
  DashboardBlockInterface,
  DashboardBlockType,
} from "back-end/src/enterprise/validators/dashboard-block";
import React, { useMemo, useState } from "react";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { isDefined } from "shared/util";
import { PiDotsThreeVertical, PiPlusCircle } from "react-icons/pi";
import { isPersistedDashboardBlock } from "shared/enterprise";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/Radix/Tabs";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenu,
} from "@/components/Radix/DropdownMenu";
import Avatar from "@/components/Radix/Avatar";
import {
  DASHBOARD_WORKSPACE_NAV_BOTTOM_PADDING,
  DASHBOARD_WORKSPACE_NAV_HEIGHT,
} from "@/enterprise/components/Dashboards/DashboardWorkspace";
import { BLOCK_SUBGROUPS, BLOCK_TYPE_INFO } from "..";
import EditSingleBlock from "./EditSingleBlock";

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

interface Props {
  experiment: ExperimentInterfaceStringDates;
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
  experiment,
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
      <Text style={{ color: "var(--color-text-mid)" }}>
        Click to add blocks.
      </Text>
      {BLOCK_SUBGROUPS.map(([subgroup, blockTypes], i) => (
        <Flex
          direction="column"
          gap="2"
          align="start"
          key={`${subgroup}-${i}`}
          width="100%"
        >
          <Text
            weight="medium"
            size="1"
            style={{
              color: "var(--color-text-high)",
              textTransform: "uppercase",
            }}
          >
            {subgroup}
          </Text>
          {blockTypes.map((bType) => (
            <a
              href="#"
              key={bType}
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
                <Text
                  size="2"
                  weight="regular"
                  style={{ color: "var(--color-text-high" }}
                >
                  {BLOCK_TYPE_INFO[bType].name}
                </Text>
                <div style={{ flex: 1 }} />
                <Text color="violet" className="ml-auto show-target instant">
                  <PiPlusCircle /> Add
                </Text>
              </Flex>
            </a>
          ))}
        </Flex>
      ))}
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
          <EditSingleBlock
            experiment={experiment}
            cancel={cancel}
            submit={submit}
            block={stagedBlock}
            setBlock={setStagedBlock}
          />
        ) : !blockNavigatorEnabled ? (
          <div style={{ width: "440px" }}>
            <Box px="4" pt="4">
              <Text size="3" weight="bold">
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
                <Text style={{ color: "var(--color-text-mid)" }} my="3">
                  Drag to reorder blocks. Click to bring block into focus.
                </Text>
                {displayBlocks.map((block, i) => (
                  <Flex
                    width="100%"
                    justify="between"
                    key={isPersistedDashboardBlock(block) ? block.id : i}
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
                        <Text color="red">Delete</Text>
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
