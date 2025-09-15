import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import React, { Fragment, ReactElement, useEffect, useState } from "react";
import {
  PiCaretDownFill,
  PiPlus,
  PiTableDuotone,
  PiPencilSimpleFill,
  PiChartLineDuotone,
  PiFileSqlDuotone,
  PiListDashesDuotone,
  PiArticleMediumDuotone,
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
import Button from "@/ui/Button";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";
import Callout from "@/ui/Callout";
import Field from "@/components/Forms/Field";
import DashboardBlock from "./DashboardBlock";
import DashboardUpdateDisplay from "./DashboardUpdateDisplay";

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
  isTabActive: boolean;
  experiment: ExperimentInterfaceStringDates;
  title: string;
  blocks: DashboardBlockInterfaceOrData<DashboardBlockInterface>[];
  isEditing: boolean;
  enableAutoUpdates: boolean;
  editSidebarDirty: boolean;
  focusedBlockIndex: number | undefined;
  stagedBlockIndex: number | undefined;
  scrollAreaRef: null | React.MutableRefObject<HTMLDivElement | null>;
  setBlock: (
    index: number,
    block: DashboardBlockInterfaceOrData<DashboardBlockInterface>,
  ) => void;
  setTitle?: (title: string) => Promise<void>;
  moveBlock: (index: number, direction: -1 | 1) => void;
  addBlockType: (bType: DashboardBlockType, i?: number) => void;
  editBlock: (index: number) => void;
  duplicateBlock: (index: number) => void;
  deleteBlock: (index: number) => void;
  mutate: () => void;
}

function DashboardEditor({
  isTabActive,
  experiment,
  title,
  blocks,
  isEditing,
  enableAutoUpdates,
  editSidebarDirty,
  focusedBlockIndex,
  stagedBlockIndex,
  scrollAreaRef,
  setBlock,
  setTitle,
  moveBlock,
  addBlockType,
  editBlock,
  duplicateBlock,
  deleteBlock,
  mutate,
}: Props) {
  const [editingTitle, setEditingTitle] = useState(false);

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
              />
            </Flex>
          )}
        </Container>
      </Flex>
    );
  };

  const canEditTitle = isEditing && !!setTitle;

  return (
    <div>
      <Flex
        align="end"
        height={DASHBOARD_TOPBAR_HEIGHT}
        className="mb-3"
        gap="1"
      >
        {canEditTitle && editingTitle ? (
          <Field
            autoFocus
            defaultValue={title}
            placeholder="Title"
            onFocus={(e) => {
              e.target.select();
            }}
            onBlur={(e) => {
              setEditingTitle(false);
              const newTitle = e.target.value;
              if (newTitle !== title) {
                setTitle(newTitle);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                (e.target as HTMLInputElement).blur();
              } else if (e.key === "Escape") {
                setEditingTitle(false);
              }
            }}
            containerClassName="flex-1"
          />
        ) : (
          <>
            <Text
              weight="medium"
              size="5"
              onDoubleClick={
                canEditTitle
                  ? (e) => {
                      e.preventDefault();
                      setEditingTitle(true);
                    }
                  : undefined
              }
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                flexShrink: 1,
              }}
            >
              {title}
            </Text>
            {canEditTitle && (
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  setEditingTitle(true);
                }}
                className="ml-2"
                style={{ color: "var(--violet-9)", paddingBottom: 5 }}
                title="Edit Title"
              >
                <PiPencilSimpleFill />
              </a>
            )}
            <div style={{ flexGrow: 1 }} />
          </>
        )}
        <DashboardUpdateDisplay
          blocks={blocks}
          enableAutoUpdates={enableAutoUpdates}
          disabled={editSidebarDirty}
          isEditing={isEditing}
        />
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
