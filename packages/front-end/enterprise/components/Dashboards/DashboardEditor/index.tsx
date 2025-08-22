import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import React, { Fragment, useEffect, useRef, useState } from "react";
import { PiCaretDownFill, PiPlus } from "react-icons/pi";
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
import Button from "@/components/Radix/Button";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/Radix/DropdownMenu";
import Tooltip from "@/components/Tooltip/Tooltip";
import Callout from "@/components/Radix/Callout";
import { DASHBOARD_WORKSPACE_NAV_HEIGHT } from "../DashboardWorkspace";
import DashboardBlock from "./DashboardBlock";
import DashboardUpdateDisplay from "./DashboardUpdateDisplay";

export const DASHBOARD_TOPBAR_HEIGHT = "40px";
export const BLOCK_TYPE_INFO: Record<DashboardBlockType, { name: string }> = {
  markdown: {
    name: "Markdown",
  },
  "experiment-metadata": {
    name: "Experiment Metadata",
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
  "experiment-traffic": {
    name: "Experiment Traffic",
  },
  "sql-explorer": {
    name: "SQL Explorer",
  },
};

export const BLOCK_SUBGROUPS: [string, DashboardBlockType[]][] = [
  [
    "Metric Results",
    ["experiment-metric", "experiment-dimension", "experiment-time-series"],
  ],
  ["Experiment Info", ["experiment-metadata", "experiment-traffic"]],
  ["Other", ["markdown", "sql-explorer"]],
];

function AddBlockDropdown({
  trigger,
  addBlockType,
  onDropdownOpen,
  onDropdownClose,
}: {
  trigger: React.ReactNode;
  addBlockType: (bType: DashboardBlockType) => void;
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
  title: string;
  blocks: DashboardBlockInterfaceOrData<DashboardBlockInterface>[];
  isEditing: boolean;
  enableAutoUpdates: boolean;
  editSidebarDirty: boolean;
  focusedBlockIndex: number | undefined;
  stagedBlockIndex: number | undefined;
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
}

function DashboardEditor({
  experiment,
  title,
  blocks,
  isEditing,
  enableAutoUpdates,
  editSidebarDirty,
  focusedBlockIndex,
  stagedBlockIndex,
  setBlock,
  moveBlock,
  addBlockType,
  editBlock,
  duplicateBlock,
  deleteBlock,
  mutate,
}: Props) {
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);
  const [hoverAddBlock, setHoverAddBlock] = useState<number | undefined>(
    undefined,
  );
  const [showAddBlock, setShowAddBlock] = useState<number | undefined>(
    undefined,
  );
  const [addBlockDropdown, setAddBlockDropdown] = useState<number | undefined>(
    undefined,
  );

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
          block={block}
          dashboardExperiment={experiment}
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
          py="1em"
          onMouseEnter={() => {
            if (!isDefined(addBlockDropdown)) setShowAddBlock(i);
          }}
          onMouseLeave={() => {
            if (!isDefined(addBlockDropdown)) setShowAddBlock(undefined);
          }}
          className={clsx({
            "dashboard-disabled": editSidebarDirty,
          })}
        >
          {isEditing && (
            <Flex justify="center" position="relative">
              {isDefined(i) &&
                (hoverAddBlock === i || addBlockDropdown === i) && (
                  <div
                    style={{
                      pointerEvents: "none",
                      position: "absolute",
                      top: "0",
                      width: "100%",
                      height: "50%",
                      borderBottom: "1px solid var(--violet-a9)",
                    }}
                  />
                )}
              <AddBlockDropdown
                onDropdownOpen={() => setAddBlockDropdown(i)}
                onDropdownClose={() => {
                  setAddBlockDropdown(undefined);
                  setShowAddBlock(undefined);
                }}
                trigger={
                  <IconButton
                    onMouseEnter={() => {
                      setHoverAddBlock(i);
                    }}
                    onMouseLeave={() => {
                      setHoverAddBlock(undefined);
                    }}
                    className={clsx({
                      "opacity-0": showAddBlock !== i && !isLastBlock,
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
        </Container>
      </Flex>
    );
  };

  return (
    <div>
      <Flex align="end" justify="between" height={DASHBOARD_TOPBAR_HEIGHT}>
        <Flex align="center" gap="1">
          {isEditing && (
            <Text weight="medium" size="5">
              {title}
            </Text>
          )}
        </Flex>
        <DashboardUpdateDisplay
          blocks={blocks}
          enableAutoUpdates={enableAutoUpdates}
          disabled={editSidebarDirty}
          isEditing={isEditing}
        />
      </Flex>
      <div
        ref={scrollAreaRef}
        style={{
          maxHeight: `calc(100vh - ${DASHBOARD_WORKSPACE_NAV_HEIGHT} - ${DASHBOARD_TOPBAR_HEIGHT}`,
          overflowY: "scroll",
        }}
      >
        {blocks.length === 0 ? (
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
                  Add Content Blocks
                </Heading>
                <Text align="center">Choose a block type to get started.</Text>
              </Flex>
              <AddBlockDropdown
                addBlockType={addBlockType}
                trigger={
                  <Button
                    size="xs"
                    icon={<PiCaretDownFill />}
                    iconPosition="right"
                  >
                    Add block
                  </Button>
                }
              />
            </Flex>
          </div>
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
      </div>
    </div>
  );
}

export default withErrorBoundary(DashboardEditor, {
  fallback: <Callout status="error">Failed to load dashboard</Callout>,
});
