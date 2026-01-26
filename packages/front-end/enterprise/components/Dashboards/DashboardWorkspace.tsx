import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  DashboardInterface,
  DashboardBlockInterfaceOrData,
  DashboardBlockInterface,
  DashboardBlockType,
  CREATE_BLOCK_TYPE,
  getBlockData,
} from "shared/enterprise";
import { Container, Flex, IconButton, Text } from "@radix-ui/themes";
import {
  PiCaretDoubleLeft,
  PiCaretDoubleRight,
  PiCheckCircle,
  PiX,
} from "react-icons/pi";
import clsx from "clsx";
import { cloneDeep, pick } from "lodash";
import { isDefined } from "shared/util";

import Button from "@/ui/Button";
import Link from "@/ui/Link";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useDefinitions } from "@/services/DefinitionsContext";
import LoadingSpinner from "@/components/LoadingSpinner";
import DashboardEditor, {
  DASHBOARD_TOPBAR_HEIGHT,
  GENERAL_DASHBOARD_BLOCK_TYPES,
  isBlockTypeAllowed,
} from "./DashboardEditor";
import { SubmitDashboard, UpdateDashboardArgs } from "./DashboardsTab";
import DashboardEditorSidebar from "./DashboardEditor/DashboardEditorSidebar";
import DashboardModal from "./DashboardModal";
import { useSeriesDisplaySettings } from "./DashboardSeriesDisplayProvider";
import EditGlobalColorDropdown from "./DashboardEditor/EditGlobalColorDropdown";
import { filterSeriesDisplaySettings } from "./seriesDisplaySettingsUtils";
export const DASHBOARD_WORKSPACE_NAV_HEIGHT = "72px";
export const DASHBOARD_WORKSPACE_NAV_BOTTOM_PADDING = "12px";

interface Props {
  isTabActive: boolean;
  experiment: ExperimentInterfaceStringDates | null;
  dashboard: DashboardInterface;
  dashboardFirstSave?: boolean;
  mutate: () => void;
  submitDashboard: SubmitDashboard<UpdateDashboardArgs>;
  close: () => void;
  // for quick editing a block from the display view
  initialEditBlockIndex?: number | null;
  onConsumeInitialEditBlockIndex?: () => void;
  updateTemporaryDashboard?: (update: {
    blocks?: DashboardBlockInterfaceOrData<DashboardBlockInterface>[];
  }) => void;
}
export default function DashboardWorkspace({
  isTabActive,
  experiment,
  dashboard,
  dashboardFirstSave,
  mutate,
  submitDashboard,
  close,
  initialEditBlockIndex,
  onConsumeInitialEditBlockIndex,
  updateTemporaryDashboard,
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
  const { getActiveSeriesKeys, getSeriesDisplaySettings } =
    useSeriesDisplaySettings();

  const scrollAreaRef = useRef<HTMLDivElement | null>(null);

  const [saving, setSaving] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>(undefined);

  const submit: SubmitDashboard<UpdateDashboardArgs> = useMemo(
    () => async (args) => {
      setSaving(true);
      setSaveError(undefined);
      try {
        const filteredSettings = filterSeriesDisplaySettings(
          // Use args if available - the only time that happens is via the Undo Changes button, otherwise use the get the current settings
          args.data.seriesDisplaySettings || getSeriesDisplaySettings(),
          // Only filter by active keys when blocks are being updated (for cleanup on removal)
          // Otherwise, just clean entries without colors
          args.data.blocks !== undefined ? getActiveSeriesKeys() : undefined,
        );

        await submitDashboard({
          ...args,
          data: {
            ...dashboard,
            ...args.data,
            ...(filteredSettings !== undefined
              ? { seriesDisplaySettings: filteredSettings }
              : {}),
          },
        });
      } catch (e) {
        setSaveError(e.message);
      } finally {
        setSaving(false);
      }
    },
    [submitDashboard, dashboard, getActiveSeriesKeys, getSeriesDisplaySettings],
  );

  const [blocks, setBlocks] = useState<
    DashboardBlockInterfaceOrData<DashboardBlockInterface>[]
  >(dashboard.blocks);
  const setBlocksAndSubmit = useMemo(() => {
    return async (
      blocks: DashboardBlockInterfaceOrData<DashboardBlockInterface>[],
    ) => {
      setHasMadeChanges(true);

      // For new dashboards, update temporary state instead of making API call
      if (dashboardFirstSave) {
        updateTemporaryDashboard?.({
          blocks,
        });
      } else {
        setBlocks(blocks);
        // For existing dashboards, make API call via submit
        await submit({
          method: "PUT",
          dashboardId: dashboard.id,
          data: {
            blocks,
          },
        });
      }
    };
  }, [
    setBlocks,
    submit,
    dashboard.id,
    dashboardFirstSave,
    updateTemporaryDashboard,
  ]);

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

  // One-shot edit (and scroll) when entering edit mode from a specific block.
  useEffect(() => {
    if (!isDefined(initialEditBlockIndex)) return;
    // This sets editingBlockIndex + stagedEditBlock and relies on DashboardBlock's
    // existing scroll behavior (it scrolls when `editingBlock` is true).
    editBlock(initialEditBlockIndex);
    onConsumeInitialEditBlockIndex?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialEditBlockIndex, onConsumeInitialEditBlockIndex]);
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
    <>
      {showSaveModal && (
        <DashboardModal
          mode="edit"
          initial={dashboard}
          close={() => setShowSaveModal(false)}
          submit={async (data) => {
            await submitDashboard({
              method: "PUT",
              dashboardId: dashboard.id,
              data,
            });
            close();
          }}
          type={isGeneralDashboard ? "general" : "experiment"}
          dashboardFirstSave={dashboardFirstSave}
        />
      )}
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
            {dashboard.id === "new" ? null : saveError ? (
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
            {dashboardCopy && hasMadeChanges && !dashboardFirstSave && (
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
                        "seriesDisplaySettings",
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
            <Flex align="center" gap="2">
              {dashboardFirstSave && (
                <Link onClick={close} color="red" type="button" weight="bold">
                  Exit without saving
                </Link>
              )}
              <Button
                className={clsx({
                  "dashboard-disabled": editSidebarDirty,
                })}
                onClick={() => {
                  dashboardFirstSave ? setShowSaveModal(true) : close();
                }}
                disabled={
                  dashboard.id === "new" && blocks.length === 0
                    ? true
                    : editSidebarDirty
                }
              >
                Done Editing
              </Button>
            </Flex>
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
              id={dashboard.id}
              ownerId={dashboard.userId}
              initialEditLevel={dashboard.editLevel}
              updateSchedule={dashboard.updateSchedule || undefined}
              initialShareLevel={dashboard.shareLevel}
              dashboardOwnerId={dashboard.userId}
              projects={
                dashboard.projects
                  ? dashboard.projects
                  : experiment?.project
                    ? [experiment.project]
                    : []
              }
              title={dashboard.title}
              blocks={effectiveBlocks}
              isEditing={true}
              isGeneralDashboard={isGeneralDashboard}
              enableAutoUpdates={dashboard.enableAutoUpdates}
              nextUpdate={
                experiment
                  ? experiment.nextSnapshotAttempt
                  : dashboard.nextUpdate
              }
              dashboardLastUpdated={dashboard.lastUpdated}
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
              editBlockProps={{
                editSidebarDirty: editSidebarDirty,
                focusedBlockIndex: focusedBlockIndex,
                stagedBlockIndex: addBlockIndex ?? editingBlockIndex,
                scrollAreaRef: scrollAreaRef,
                moveBlock: (i, direction) => {
                  if (isDefined(addBlockIndex) || isDefined(editingBlockIndex))
                    return;
                  const otherBlocks = blocks.toSpliced(i, 1);
                  setBlocksAndSubmit([
                    ...otherBlocks.slice(0, i + direction),
                    blocks[i],
                    ...otherBlocks.slice(i + direction),
                  ]);
                },
                addBlockType: addBlockType,
                editBlock: editBlock,
                duplicateBlock: (i) => {
                  setAddBlockIndex(i + 1);
                  setStagedAddBlock(getBlockData(effectiveBlocks[i]));
                },
                deleteBlock: deleteBlock,
              }}
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
              gap="2"
              style={{
                minHeight: DASHBOARD_TOPBAR_HEIGHT,
                maxHeight: DASHBOARD_TOPBAR_HEIGHT,
              }}
            >
              {editSidebarExpanded && <EditGlobalColorDropdown />}
              {isDefined(addBlockIndex) || isDefined(editingBlockIndex) ? (
                <IconButton
                  mb="1"
                  onClick={clearEditingState}
                  variant="outline"
                >
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
              dashboardId={dashboard.id}
              experiment={experiment}
              projects={dashboard.projects || []}
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
    </>
  );
}
