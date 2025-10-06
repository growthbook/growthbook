import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { DashboardInterface } from "back-end/src/enterprise/validators/dashboard";
import {
  DashboardBlockInterfaceOrData,
  DashboardBlockInterface,
  DashboardBlockType,
} from "back-end/src/enterprise/validators/dashboard-block";
import { Container, Flex, IconButton, Text } from "@radix-ui/themes";
import {
  PiCaretDoubleLeft,
  PiCaretDoubleRight,
  PiCheckCircle,
  PiX,
} from "react-icons/pi";
import clsx from "clsx";
import { cloneDeep, pick } from "lodash";
import { CREATE_BLOCK_TYPE, getBlockData } from "shared/enterprise";
import { isDefined } from "shared/util";

// Block types that are allowed in general dashboards (non-experiment specific)
const GENERAL_DASHBOARD_BLOCK_TYPES: DashboardBlockType[] = [
  "markdown",
  "sql-explorer",
  "metric-explorer",
];

// Block types that are only allowed in experiment dashboards
const EXPERIMENT_DASHBOARD_BLOCK_TYPES: DashboardBlockType[] = [
  "experiment-metadata",
  "experiment-metric",
  "experiment-dimension",
  "experiment-time-series",
  "experiment-traffic",
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
import Button from "@/ui/Button";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useDefinitions } from "@/services/DefinitionsContext";
import LoadingSpinner from "@/components/LoadingSpinner";
import DashboardEditor, { DASHBOARD_TOPBAR_HEIGHT } from "./DashboardEditor";
import { SubmitDashboard, UpdateDashboardArgs } from "./DashboardsTab";
import DashboardEditorSidebar from "./DashboardEditor/DashboardEditorSidebar";

export const DASHBOARD_WORKSPACE_NAV_HEIGHT = "72px";
export const DASHBOARD_WORKSPACE_NAV_BOTTOM_PADDING = "12px";

interface Props {
  isTabActive: boolean;
  experiment: ExperimentInterfaceStringDates | null;
  dashboard: DashboardInterface;
  mutate: () => void;
  submitDashboard: SubmitDashboard<UpdateDashboardArgs>;
  close: () => void;
}
export default function DashboardWorkspace({
  isTabActive,
  experiment,
  dashboard,
  mutate,
  submitDashboard,
  close,
}: Props) {
  // Determine if this is a general dashboard (no experiment linked)
  const isGeneralDashboard = !experiment || dashboard.experimentId === "";
  useEffect(() => {
    const bodyElements = window.document.getElementsByTagName("body");
    for (const element of bodyElements) {
      element.classList.add("no-scroll");
    }
    return () => {
      for (const element of bodyElements) {
        element.classList.remove("no-scroll");
      }
    };
  }, []);
  useEffect(() => {
    if (dashboard) {
      setBlocks(dashboard.blocks);
    } else {
      setBlocks([]);
    }
  }, [dashboard]);
  const { metricGroups } = useDefinitions();

  const scrollAreaRef = useRef<HTMLDivElement | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>(undefined);
  const submit: SubmitDashboard<UpdateDashboardArgs> = useMemo(
    () => async (args) => {
      setSaving(true);
      setSaveError(undefined);
      try {
        await submitDashboard(args);
      } catch (e) {
        setSaveError(e.message);
      } finally {
        setSaving(false);
      }
    },
    [submitDashboard],
  );

  const [blocks, setBlocks] = useState<
    DashboardBlockInterfaceOrData<DashboardBlockInterface>[]
  >(dashboard.blocks);
  const setBlocksAndSubmit = useMemo(() => {
    return async (
      blocks: DashboardBlockInterfaceOrData<DashboardBlockInterface>[],
    ) => {
      setBlocks(blocks);
      setHasMadeChanges(true);
      await submit({
        method: "PUT",
        dashboardId: dashboard.id,
        data: {
          blocks,
        },
      });
    };
  }, [setBlocks, submit, dashboard.id]);

  const [editSidebarExpanded, setEditSidebarExpanded] = useState(true);
  const [editSidebarDirty, setEditSidebarDirty] = useState(false);
  const [hasMadeChanges, setHasMadeChanges] = useState(false);

  const clearEditingState = () => {
    setAddBlockIndex(undefined);
    setStagedAddBlock(undefined);
    setEditingBlockIndex(undefined);
    setStagedEditBlock(undefined);
    setEditSidebarDirty(false);
    setFocusedBlockIndex(undefined);
  };

  const [focusedBlockIndex, setFocusedBlockIndex] = useState<
    number | undefined
  >(undefined);
  const [editingBlockIndex, setEditingBlockIndex] = useState<
    number | undefined
  >(undefined);
  const [addBlockIndex, setAddBlockIndex] = useState<number | undefined>(
    undefined,
  );
  const [stagedAddBlock, setStagedAddBlock] = useState<
    DashboardBlockInterfaceOrData<DashboardBlockInterface> | undefined
  >(undefined);
  const [stagedEditBlock, setStagedEditBlock] = useState<
    DashboardBlockInterfaceOrData<DashboardBlockInterface> | undefined
  >(undefined);

  const [dashboardCopy] = useState<DashboardInterface | undefined>(
    cloneDeep(dashboard),
  );

  const addBlockType = (bType: DashboardBlockType, index?: number) => {
    // Validate that the block type is allowed for this dashboard type
    if (!isBlockTypeAllowed(bType, isGeneralDashboard)) {
      console.warn(
        `Block type ${bType} is not allowed for ${isGeneralDashboard ? "general" : "experiment"} dashboards`,
      );
      return;
    }

    index = index ?? blocks.length;

    // For general dashboards, only allow blocks that don't require experiment
    if (isGeneralDashboard && !GENERAL_DASHBOARD_BLOCK_TYPES.includes(bType)) {
      console.warn(
        `Block type ${bType} requires an experiment and cannot be used in general dashboards`,
      );
      return;
    }

    // Create the block with appropriate parameters
    const blockData = CREATE_BLOCK_TYPE[bType]({
      experiment: experiment!,
      metricGroups,
    });

    setStagedAddBlock(blockData);
    setAddBlockIndex(index);
    setEditSidebarDirty(true);
  };

  const effectiveBlocks = blocks
    .flatMap<DashboardBlockInterfaceOrData<DashboardBlockInterface>>(
      (block, i) => {
        // Show in-progress edits directly on the block
        const isEditingBlock = i === editingBlockIndex;
        const effectiveBlock = isEditingBlock
          ? (stagedEditBlock ?? block)
          : block;
        if (i === addBlockIndex && isDefined(stagedAddBlock)) {
          return [stagedAddBlock, effectiveBlock];
        }
        return effectiveBlock;
      },
    )
    .concat(
      addBlockIndex === blocks.length && isDefined(stagedAddBlock)
        ? [stagedAddBlock]
        : [],
    );

  const focusBlock = (i: number) => {
    setFocusedBlockIndex(i);
  };

  const editBlock = (i: number) => {
    setEditSidebarExpanded(true);
    setFocusedBlockIndex(undefined);
    setEditingBlockIndex(i);
    setEditSidebarDirty(true);
    setStagedEditBlock(effectiveBlocks[i]);
  };

  const deleteBlock = (i: number) => {
    setBlocksAndSubmit([...blocks.slice(0, i), ...blocks.slice(i + 1)]);
    clearEditingState();
  };

  return (
    <Container
      position="fixed"
      top="0"
      left="0"
      right="0"
      bottom="0"
      maxWidth="100%"
      style={{
        backgroundColor: "var(--surface-background-color)",
        zIndex: 9000,
      }}
    >
      <Flex
        justify="between"
        align="center"
        px="7"
        style={{
          height: DASHBOARD_WORKSPACE_NAV_HEIGHT,
          borderBottom: `${DASHBOARD_WORKSPACE_NAV_BOTTOM_PADDING} solid var(--violet-2)`,
        }}
      >
        <Flex align="center" gap="1">
          {saveError ? (
            <Tooltip body={saveError} delay={0}>
              <PiX color="red" />
              <Text color="red" ml="1" size="1">
                Error saving dashboard
              </Text>
            </Tooltip>
          ) : saving ? (
            <>
              <LoadingSpinner />
              <Text size="1">Saving...</Text>
            </>
          ) : (
            <>
              <PiCheckCircle style={{ color: "var(--violet-11)" }} />
              <Text size="1">Edits are saved automatically</Text>
            </>
          )}
        </Flex>
        <Flex align="center" gap="4">
          {dashboardCopy && hasMadeChanges && (
            <Tooltip
              body="Undo all changes made during this current edit session"
              tipPosition="top"
            >
              <Button
                className={clsx({
                  "dashboard-disabled": editSidebarDirty,
                })}
                onClick={async () => {
                  await submit({
                    method: "PUT",
                    dashboardId: dashboard.id,
                    data: pick(dashboardCopy, [
                      "blocks",
                      "title",
                      "editLevel",
                      "enableAutoUpdates",
                    ]),
                  });
                  close();
                }}
                variant="ghost"
                color="red"
              >
                Undo Changes
              </Button>
            </Tooltip>
          )}
          <Button
            className={clsx({
              "dashboard-disabled": editSidebarDirty,
            })}
            onClick={close}
          >
            Done Editing
          </Button>
        </Flex>
      </Flex>
      <Flex
        height={`calc(100vh - ${DASHBOARD_WORKSPACE_NAV_HEIGHT})`}
        maxHeight={`calc(100vh - ${DASHBOARD_WORKSPACE_NAV_HEIGHT})`}
        overflowY="scroll"
        px="7"
        gap="4"
        style={{ backgroundColor: "var(--violet-2)" }}
        ref={scrollAreaRef}
      >
        <div style={{ flexGrow: 1, minWidth: 0 }}>
          <DashboardEditor
            isTabActive={isTabActive}
            title={dashboard.title}
            blocks={effectiveBlocks}
            isEditing={true}
            enableAutoUpdates={dashboard.enableAutoUpdates}
            nextUpdate={experiment ? experiment.nextSnapshotAttempt : undefined}
            editSidebarDirty={editSidebarDirty}
            focusedBlockIndex={focusedBlockIndex}
            stagedBlockIndex={addBlockIndex ?? editingBlockIndex}
            scrollAreaRef={scrollAreaRef}
            setBlock={(i, block) => {
              if (i === editingBlockIndex) {
                setStagedEditBlock(block);
              } else if (i === addBlockIndex) {
                setStagedAddBlock(block);
              } else {
                setBlocksAndSubmit([
                  ...blocks.slice(0, i),
                  block,
                  ...blocks.slice(i + 1),
                ]);
              }
            }}
            moveBlock={(i, direction) => {
              if (isDefined(addBlockIndex) || isDefined(editingBlockIndex))
                return;
              const otherBlocks = blocks.toSpliced(i, 1);
              setBlocksAndSubmit([
                ...otherBlocks.slice(0, i + direction),
                blocks[i],
                ...otherBlocks.slice(i + direction),
              ]);
            }}
            addBlockType={addBlockType}
            editBlock={editBlock}
            duplicateBlock={(i) => {
              setAddBlockIndex(i + 1);
              setStagedAddBlock(getBlockData(effectiveBlocks[i]));
            }}
            deleteBlock={deleteBlock}
            mutate={mutate}
          />
        </div>
        <Flex
          direction="column"
          align="end"
          style={{
            position: "sticky",
            top: 0,
          }}
        >
          <Flex
            align="end"
            style={{
              minHeight: DASHBOARD_TOPBAR_HEIGHT,
              maxHeight: DASHBOARD_TOPBAR_HEIGHT,
            }}
          >
            {isDefined(addBlockIndex) || isDefined(editingBlockIndex) ? (
              <IconButton mb="1" onClick={clearEditingState} variant="outline">
                <PiX />
              </IconButton>
            ) : (
              <IconButton
                mb="1"
                onClick={() => setEditSidebarExpanded(!editSidebarExpanded)}
                variant="outline"
              >
                {editSidebarExpanded ? (
                  <PiCaretDoubleRight />
                ) : (
                  <PiCaretDoubleLeft />
                )}
              </IconButton>
            )}
          </Flex>

          <DashboardEditorSidebar
            experiment={experiment}
            isGeneralDashboard={isGeneralDashboard}
            open={editSidebarExpanded}
            cancel={clearEditingState}
            submit={() => {
              if (isDefined(addBlockIndex) && isDefined(stagedAddBlock)) {
                setBlocksAndSubmit([
                  ...blocks.slice(0, addBlockIndex),
                  stagedAddBlock,
                  ...blocks.slice(addBlockIndex),
                ]);
              } else if (
                isDefined(editingBlockIndex) &&
                isDefined(stagedEditBlock)
              ) {
                setBlocksAndSubmit([
                  ...blocks.slice(0, editingBlockIndex),
                  stagedEditBlock,
                  ...blocks.slice(editingBlockIndex + 1),
                ]);
              }
              clearEditingState();
            }}
            blocks={blocks}
            stagedBlock={
              isDefined(stagedAddBlock) ? stagedAddBlock : stagedEditBlock
            }
            setBlocks={setBlocksAndSubmit}
            setStagedBlock={(block) => {
              isDefined(stagedAddBlock)
                ? setStagedAddBlock(block)
                : setStagedEditBlock(block);
              setEditSidebarDirty(true);
            }}
            addBlockType={addBlockType}
            focusBlock={focusBlock}
            editBlock={editBlock}
            duplicateBlock={(i) => {
              setAddBlockIndex(i + 1);
              setStagedAddBlock(getBlockData(effectiveBlocks[i]));
            }}
            deleteBlock={deleteBlock}
          />
        </Flex>
      </Flex>
    </Container>
  );
}
