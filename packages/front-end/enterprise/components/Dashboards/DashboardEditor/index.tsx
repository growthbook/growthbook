import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import React, { Fragment, useState } from "react";
import { PiCaretDownFill, PiPlus } from "react-icons/pi";
import {
  DashboardBlockData,
  DashboardBlockInterface,
  DashboardBlockType,
} from "back-end/src/enterprise/validators/dashboard-block";
import { isDefined } from "shared/util";
import { Flex, Heading, IconButton, Text } from "@radix-ui/themes";
import clsx from "clsx";
import { getBlockData } from "shared/enterprise";
import Button from "@/components/Radix/Button";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/Radix/DropdownMenu";
import DashboardSnapshotProvider from "../DashboardSnapshotProvider";
import DashboardBlock from "./DashboardBlock";
import DashboardBlockEditDrawer from "./DashboardBlockEditDrawer";

export const BLOCK_TYPE_INFO: Record<
  DashboardBlockType,
  {
    name: string;
    createDefaultBlock: (args: {
      experiment: ExperimentInterfaceStringDates;
    }) => DashboardBlockData<DashboardBlockInterface>;
  }
> = {
  markdown: {
    name: "Custom Markdown",
    createDefaultBlock: () => ({
      type: "markdown",
      title: "",
      description: "",
      content: "",
    }),
  },
  "metadata-description": {
    name: "Description",
    createDefaultBlock: ({ experiment }) => ({
      type: "metadata-description",
      title: "",
      description: "",
      experimentId: experiment.id,
    }),
  },
  "metadata-hypothesis": {
    name: "Hypothesis",
    createDefaultBlock: ({ experiment }) => ({
      type: "metadata-hypothesis",
      title: "",
      description: "",
      experimentId: experiment.id,
    }),
  },
  "variation-image": {
    name: "Variations / Screenshots",
    createDefaultBlock: ({ experiment }) => ({
      type: "variation-image",
      title: "",
      description: "",
      variationIds: [],
      experimentId: experiment.id,
    }),
  },
  metric: {
    name: "Metric Results",
    createDefaultBlock: ({ experiment }) => ({
      type: "metric",
      title: "",
      description: "",
      experimentId: experiment.id,
      metricIds: experiment.goalMetrics,
      snapshotId: experiment.analysisSummary?.snapshotId || "",
      differenceType: "relative",
      baselineRow: 0,
      columnsFilter: [],
    }),
  },
  dimension: {
    name: "Dimension Results",
    createDefaultBlock: ({ experiment }) => ({
      type: "dimension",
      title: "",
      description: "",
      experimentId: experiment.id,
      metricIds: experiment.goalMetrics,
      dimensionIds: [],
      snapshotId: experiment.analysisSummary?.snapshotId || "",
      differenceType: "relative",
      baselineRow: 0,
      columnsFilter: [],
    }),
  },
  "time-series": {
    name: "Time Series",
    createDefaultBlock: ({ experiment }) => ({
      type: "time-series",
      title: "",
      description: "",
      experimentId: experiment.id,
      metricId: "",
      snapshotId: experiment.analysisSummary?.snapshotId || "",
    }),
  },
  "traffic-graph": {
    name: "Traffic over Time",
    createDefaultBlock: ({ experiment }) => ({
      type: "traffic-graph",
      title: "",
      description: "",
      experimentId: experiment.id,
    }),
  },
  "traffic-table": {
    name: "Traffic",
    createDefaultBlock: ({ experiment }) => ({
      type: "traffic-table",
      title: "",
      description: "",
      experimentId: experiment.id,
    }),
  },
  "sql-explorer": {
    name: "SQL Explorer",
    createDefaultBlock: () => ({
      type: "sql-explorer",
      title: "",
      description: "",
      dataVizConfigIndex: 0,
    }),
  },
};

const BLOCK_SUBGROUPS: [string, DashboardBlockType[]][] = [
  ["Metric Results", ["metric", "dimension", "time-series"]],
  ["Experiment Traffic", ["traffic-table", "traffic-graph"]],
  [
    "Experiment Overview",
    ["metadata-description", "metadata-hypothesis", "variation-image"],
  ],
  ["Other", ["markdown", "sql-explorer"]],
];

function AddBlockDropdown({
  trigger,
  addBlockType,
  setIsEditing,
}: {
  trigger: React.ReactNode;
  addBlockType: (bType: DashboardBlockType) => void;
  setIsEditing?: React.Dispatch<boolean>;
}) {
  const [dropdownOpen, setDropdownOpen] = useState<boolean>(false);

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
        <Fragment key={subgroup}>
          <DropdownMenuLabel className="font-weight-bold">
            <Text style={{ color: "var(--color-text-high)" }}>{subgroup}</Text>
          </DropdownMenuLabel>
          {blockTypes.map((bType) => (
            <DropdownMenuItem
              key={bType}
              onClick={() => {
                setDropdownOpen(false);
                addBlockType(bType);
                setIsEditing?.(true);
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
  blocks: DashboardBlockData<DashboardBlockInterface>[];
  canEdit: boolean;
  isEditing: boolean;
  editingBlock: number | undefined;
  setBlocks: React.Dispatch<DashboardBlockData<DashboardBlockInterface>[]>;
  setIsEditing: React.Dispatch<boolean>;
  setEditingBlock: React.Dispatch<number | undefined>;
  mutate: () => void;
}

export default function DashboardEditor({
  experiment,
  blocks,
  canEdit,
  isEditing,
  editingBlock,
  setBlocks,
  setIsEditing,
  setEditingBlock,
  mutate,
}: Props) {
  // TODO
  const scrollToIndex = (_i: number) => {};

  const addBlockType = (bType: DashboardBlockType, index?: number) => {
    index = index ?? blocks.length;
    setBlocks([
      ...blocks.slice(0, index),
      BLOCK_TYPE_INFO[bType].createDefaultBlock({
        experiment,
      }),
      ...blocks.slice(index),
    ]);
    scrollToIndex(index);
  };

  if (blocks.length === 0) {
    return (
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
            Choose a block type to get started. Rearrange blocks to tell a story
            with experiment data.
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
            setIsEditing={setIsEditing}
          />
        )}
      </Flex>
    );
  }

  return (
    <DashboardSnapshotProvider experiment={experiment}>
      <div className="mt-3">
        <Flex justify="between" align="center" mb="2">
          <div>
            {isEditing && (
              <AddBlockDropdown
                trigger={
                  <Button
                    className={clsx({
                      "dashboard-disabled": editingBlock !== undefined,
                    })}
                    icon={<PiCaretDownFill />}
                    iconPosition="right"
                  >
                    Add block
                  </Button>
                }
                addBlockType={(bType) => addBlockType(bType, blocks.length)}
              />
            )}
          </div>
        </Flex>

        <div className="">
          {blocks.map((block, i) => (
            <Flex direction="column" key={i}>
              <DashboardBlock
                block={block}
                experiment={experiment}
                isEditing={isEditing}
                editingBlock={editingBlock === i}
                disableBlock={(editingBlock ?? i) !== i}
                setBlock={({ title, description }) => {
                  setBlocks([
                    ...blocks.slice(0, i),
                    { ...block, title, description },
                    ...blocks.slice(i + 1),
                  ]);
                }}
                editBlock={() => {
                  setEditingBlock(i);
                }}
                duplicateBlock={() => {
                  setBlocks([
                    ...blocks.slice(0, i + 1),
                    getBlockData(block),
                    ...blocks.slice(i + 1),
                  ]);
                }}
                deleteBlock={() => {
                  setBlocks([...blocks.slice(0, i), ...blocks.slice(i + 1)]);
                }}
                moveBlock={(direction) => {
                  const otherBlocks = blocks.toSpliced(i, 1);
                  setBlocks([
                    ...otherBlocks.slice(0, i + direction),
                    block,
                    ...otherBlocks.slice(i + direction),
                  ]);
                }}
                mutate={mutate}
              />
              {isEditing && (
                <Flex justify="center" mb="2">
                  <AddBlockDropdown
                    trigger={
                      <IconButton
                        className={clsx({
                          "dashboard-disabled": editingBlock !== undefined,
                        })}
                        size="1"
                      >
                        <PiPlus size="10" />
                      </IconButton>
                    }
                    addBlockType={(bType: DashboardBlockType) =>
                      addBlockType(bType, i + 1)
                    }
                  />
                </Flex>
              )}
            </Flex>
          ))}
        </div>
      </div>

      <DashboardBlockEditDrawer
        experiment={experiment}
        open={isDefined(editingBlock)}
        close={() => setEditingBlock(undefined)}
        block={isDefined(editingBlock) ? blocks[editingBlock] : undefined}
        setBlock={(block) => {
          if (editingBlock === undefined) return;
          setBlocks([
            ...blocks.slice(0, editingBlock),
            block,
            ...blocks.slice(editingBlock + 1),
          ]);
        }}
      />
    </DashboardSnapshotProvider>
  );
}
