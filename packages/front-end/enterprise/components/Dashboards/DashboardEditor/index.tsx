import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import React, { Fragment, useEffect, useRef, useState } from "react";
import { PiCaretDownFill, PiPlus } from "react-icons/pi";
import {
  DashboardBlockInterfaceOrData,
  DashboardBlockInterface,
  DashboardBlockType,
} from "back-end/src/enterprise/validators/dashboard-block";
import { isDefined } from "shared/util";
import { Flex, Heading, IconButton, Text } from "@radix-ui/themes";
import clsx from "clsx";
import { CREATE_BLOCK_TYPE, getBlockData } from "shared/enterprise";
import { withErrorBoundary } from "@sentry/react";
import Button from "@/components/Radix/Button";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/Radix/DropdownMenu";
import Tooltip from "@/components/Tooltip/Tooltip";
import Callout from "@/components/Radix/Callout";
import { useDefinitions } from "@/services/DefinitionsContext";
import DashboardBlock from "./DashboardBlock";
import DashboardBlockEditDrawer from "./DashboardBlockEditDrawer";
import DashboardUpdateDisplay from "./DashboardUpdateDisplay";

export const BLOCK_TYPE_INFO: Record<
  DashboardBlockType,
  { name: string; hideTitle?: boolean }
> = {
  markdown: {
    name: "Markdown",
  },
  "experiment-description": {
    name: "Experiment Description",
  },
  "experiment-hypothesis": {
    name: "Experiment Hypothesis",
  },
  "experiment-variation-image": {
    name: "Variations / Screenshots",
  },
  "experiment-metric": {
    name: "Metric Results",
  },
  "experiment-dimension": {
    name: "Dimension Results",
  },
  "experiment-time-series": {
    name: "Time Series",
  },
  "experiment-traffic-graph": {
    name: "Traffic Time Series",
    hideTitle: true,
  },
  "experiment-traffic-table": {
    name: "Traffic",
  },
  "sql-explorer": {
    name: "SQL Explorer",
    hideTitle: true,
  },
};

const BLOCK_SUBGROUPS: [string, DashboardBlockType[]][] = [
  [
    "Metric Results",
    ["experiment-metric", "experiment-dimension", "experiment-time-series"],
  ],
  [
    "Experiment Traffic",
    ["experiment-traffic-table", "experiment-traffic-graph"],
  ],
  [
    "Experiment Overview",
    [
      "experiment-description",
      "experiment-hypothesis",
      "experiment-variation-image",
    ],
  ],
  ["Other", ["markdown", "sql-explorer"]],
];

function AddBlockDropdown({
  trigger,
  addBlockType,
  forceToEditing,
  onDropdownOpen,
  onDropdownClose,
}: {
  trigger: React.ReactNode;
  addBlockType: (bType: DashboardBlockType) => void;
  forceToEditing?: () => void;
  onDropdownOpen?: () => void;
  onDropdownClose?: () => void;
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
      {BLOCK_SUBGROUPS.map(([subgroup, blockTypes], i) => (
        <Fragment key={`${subgroup}-${i}`}>
          <DropdownMenuLabel className="font-weight-bold">
            <Text style={{ color: "var(--color-text-high)" }}>{subgroup}</Text>
          </DropdownMenuLabel>
          {blockTypes.map((bType) => (
            <DropdownMenuItem
              key={bType}
              onClick={() => {
                forceToEditing?.();
                setDropdownOpen(false);
                addBlockType(bType);
              }}
            >
              {BLOCK_TYPE_INFO[bType].name}
            </DropdownMenuItem>
          ))}
          {i < BLOCK_SUBGROUPS.length - 1 && <DropdownMenuSeparator />}
        </Fragment>
      ))}
    </DropdownMenu>
  );
}

interface Props {
  experiment: ExperimentInterfaceStringDates;
  blocks: DashboardBlockInterfaceOrData<DashboardBlockInterface>[];
  canEdit: boolean;
  isEditing: boolean;
  editDrawerOpen: boolean;
  enableAutoUpdates: boolean;
  setBlocks: React.Dispatch<
    DashboardBlockInterfaceOrData<DashboardBlockInterface>[]
  >;
  forceToEditing: () => void;
  setEditDrawerOpen: React.Dispatch<boolean>;
  mutate: () => void;
}

function DashboardEditor({
  experiment,
  blocks,
  canEdit,
  isEditing,
  editDrawerOpen,
  enableAutoUpdates,
  setBlocks,
  forceToEditing,
  setEditDrawerOpen,
  mutate,
}: Props) {
  const blockRefs = useRef<Array<HTMLDivElement | null>>([]);
  const { metricGroups } = useDefinitions();
  const [hoverAddBlock, setHoverAddBlock] = useState<number | undefined>(
    undefined,
  );
  const [addBlockDropdown, setAddBlockDropdown] = useState<number | undefined>(
    undefined,
  );
  const [editingBlockIndex, setEditingBlockIndex] = useState<
    number | undefined
  >(undefined);
  const [addBlockIndex, setAddBlockIndex] = useState<number | undefined>(
    undefined,
  );

  useEffect(() => {
    if (!isEditing) {
      setAddBlockIndex(undefined);
      setStagedAddBlock(undefined);
      setEditingBlockIndex(undefined);
      setStagedEditBlock(undefined);
    }
  }, [isEditing]);

  useEffect(() => {
    setEditDrawerOpen(isDefined(addBlockIndex) || isDefined(editingBlockIndex));
  }, [addBlockIndex, editingBlockIndex, setEditDrawerOpen]);

  const [stagedAddBlock, setStagedAddBlock] = useState<
    DashboardBlockInterfaceOrData<DashboardBlockInterface> | undefined
  >(undefined);
  const [stagedEditBlock, setStagedEditBlock] = useState<
    DashboardBlockInterfaceOrData<DashboardBlockInterface> | undefined
  >(undefined);

  useEffect(() => {
    setStagedEditBlock(
      isDefined(editingBlockIndex) ? blocks[editingBlockIndex] : undefined,
    );
  }, [editingBlockIndex, blocks]);

  const addBlockType = (bType: DashboardBlockType, index?: number) => {
    index = index ?? blocks.length;
    setStagedAddBlock(
      CREATE_BLOCK_TYPE[bType]({
        experiment,
        metricGroups,
      }),
    );
    setAddBlockIndex(index);
  };

  if (blocks.length === 0 && !isDefined(addBlockIndex)) {
    return (
      <div className="mt-3">
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
              Build a Custom Dashboard
            </Heading>
            <Text align="center">
              Choose a block type to get started. Rearrange blocks to tell a
              story with experiment data.
            </Text>
          </Flex>
          {canEdit && (
            <AddBlockDropdown
              addBlockType={addBlockType}
              trigger={
                <Button icon={<PiCaretDownFill />} iconPosition="right">
                  Add block
                </Button>
              }
              forceToEditing={forceToEditing}
            />
          )}
        </Flex>
      </div>
    );
  }

  const renderSingleBlock = ({
    i,
    key,
    block,
    setBlock,
    isEditingBlock,
  }: {
    i: number | undefined;
    key: number | string;
    block: DashboardBlockInterfaceOrData<DashboardBlockInterface>;
    setBlock: React.Dispatch<
      DashboardBlockInterfaceOrData<DashboardBlockInterface>
    >;
    isEditingBlock: boolean;
  }) => {
    return (
      <Flex
        direction="column"
        key={key}
        ref={(el) => (isDefined(i) ? (blockRefs.current[i] = el) : null)}
      >
        <DashboardBlock
          block={block}
          dashboardExperiment={experiment}
          isEditing={isEditing}
          editingBlock={isEditingBlock}
          disableBlock={editDrawerOpen && !isEditingBlock}
          isFirstBlock={i === 0}
          isLastBlock={i === blocks.length - 1}
          setBlock={setBlock}
          editBlock={() => {
            setEditingBlockIndex(i);
          }}
          duplicateBlock={() => {
            if (isDefined(i)) {
              setAddBlockIndex(i + 1);
              setStagedAddBlock(getBlockData(block));
            }
          }}
          deleteBlock={() => {
            if (isDefined(i)) {
              setBlocks([...blocks.slice(0, i), ...blocks.slice(i + 1)]);
            }
          }}
          moveBlock={(direction) => {
            if (isDefined(i)) {
              const otherBlocks = blocks.toSpliced(i, 1);
              setBlocks([
                ...otherBlocks.slice(0, i + direction),
                block,
                ...otherBlocks.slice(i + direction),
              ]);
            }
          }}
          mutate={mutate}
        />
        {isEditing && (
          <Flex justify="center" mb="1em" position="relative">
            {isDefined(i) &&
              (hoverAddBlock === i || addBlockDropdown === i) && (
                <div
                  style={{
                    pointerEvents: "none",
                    position: "absolute",
                    top: "0",
                    width: "100%",
                    height: "9px",
                    borderBottom: "1px solid var(--violet-a9)",
                    zIndex: -1,
                  }}
                />
              )}
            <AddBlockDropdown
              onDropdownOpen={() => setAddBlockDropdown(i)}
              onDropdownClose={() => setAddBlockDropdown(undefined)}
              trigger={
                <IconButton
                  onMouseEnter={() => {
                    setHoverAddBlock(i);
                  }}
                  onMouseLeave={() => {
                    setHoverAddBlock(undefined);
                  }}
                  className={clsx({
                    "dashboard-disabled": editDrawerOpen,
                  })}
                  size="1"
                >
                  <Tooltip
                    body="Add block"
                    tipPosition="top"
                    delay={0}
                    state={hoverAddBlock === i && addBlockDropdown !== i}
                    ignoreMouseEvents
                    innerClassName="px-0 py-1"
                  >
                    <Flex height="16px" align="center">
                      <PiPlus size="10" />
                    </Flex>
                  </Tooltip>
                </IconButton>
              }
              addBlockType={(bType: DashboardBlockType) => {
                if (isDefined(i)) {
                  addBlockType(bType, i + 1);
                }
              }}
            />
          </Flex>
        )}
      </Flex>
    );
  };

  return (
    <>
      <div className="mt-3">
        <Flex align="center" justify="between" mb="2">
          <Flex align="center" gap="1">
            {isEditing && (
              <AddBlockDropdown
                trigger={
                  <Button
                    className={clsx({
                      "dashboard-disabled": editDrawerOpen,
                    })}
                    icon={<PiCaretDownFill />}
                    iconPosition="right"
                    size="xs"
                  >
                    Add block
                  </Button>
                }
                addBlockType={addBlockType}
              />
            )}
          </Flex>
          <DashboardUpdateDisplay
            blocks={blocks}
            enableAutoUpdates={enableAutoUpdates}
            disabled={editDrawerOpen}
          />
        </Flex>
        <div>
          {blocks.map((block, i) => {
            // Show in-progress edits directly on the block
            const isEditingBlock = i === editingBlockIndex;
            const effectiveBlock = isEditingBlock
              ? (stagedEditBlock ?? block)
              : block;
            const effectiveSetBlock = (
              blockData: DashboardBlockInterfaceOrData<DashboardBlockInterface>,
            ) => {
              isEditingBlock
                ? setStagedEditBlock({
                    ...(stagedEditBlock ?? block),
                    ...blockData,
                  })
                : setBlocks([
                    ...blocks.slice(0, i),
                    { ...block, ...blockData },
                    ...blocks.slice(i + 1),
                  ]);
            };
            return (
              <Fragment key={`block-${i}`}>
                {addBlockIndex === i &&
                  isDefined(stagedAddBlock) &&
                  renderSingleBlock({
                    i: undefined,
                    key: "new-block",
                    block: stagedAddBlock,
                    setBlock: setStagedAddBlock,
                    isEditingBlock: true,
                  })}
                {renderSingleBlock({
                  i,
                  key: i,
                  block: effectiveBlock,
                  setBlock: effectiveSetBlock,
                  isEditingBlock,
                })}
              </Fragment>
            );
          })}
          {addBlockIndex === blocks.length &&
            isDefined(stagedAddBlock) &&
            renderSingleBlock({
              i: undefined,
              key: "new-block",
              block: stagedAddBlock,
              setBlock: setStagedAddBlock,
              isEditingBlock: true,
            })}
        </div>
      </div>

      <DashboardBlockEditDrawer
        experiment={experiment}
        open={editDrawerOpen}
        cancel={() => {
          setAddBlockIndex(undefined);
          setStagedAddBlock(undefined);
          setEditingBlockIndex(undefined);
        }}
        submit={() => {
          if (isDefined(addBlockIndex) && isDefined(stagedAddBlock)) {
            setBlocks([
              ...blocks.slice(0, addBlockIndex),
              stagedAddBlock,
              ...blocks.slice(addBlockIndex),
            ]);
          }
          if (isDefined(editingBlockIndex) && isDefined(stagedEditBlock)) {
            setBlocks([
              ...blocks.slice(0, editingBlockIndex),
              stagedEditBlock,
              ...blocks.slice(editingBlockIndex + 1),
            ]);
          }
          setAddBlockIndex(undefined);
          setStagedAddBlock(undefined);
          setEditingBlockIndex(undefined);
        }}
        block={
          isDefined(addBlockIndex)
            ? stagedAddBlock
            : isDefined(editingBlockIndex)
              ? stagedEditBlock
              : undefined
        }
        setBlock={
          isDefined(addBlockIndex) ? setStagedAddBlock : setStagedEditBlock
        }
      />
    </>
  );
}

export default withErrorBoundary(DashboardEditor, {
  fallback: <Callout status="error">Failed to load dashboard</Callout>,
});
