import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import React, { Fragment, useEffect, useRef, useState } from "react";
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
import DashboardBlock from "./DashboardBlock";
import DashboardBlockEditDrawer from "./DashboardBlockEditDrawer";
import DashboardUpdateDisplay from "./DashboardUpdateDisplay";

type CreateBlock<T extends DashboardBlockInterface> = (args: {
  experiment: ExperimentInterfaceStringDates;
  initialValues?: Partial<DashboardBlockData<T>>;
}) => DashboardBlockData<T>;

type BlockTypeInfo<BType extends DashboardBlockType> = {
  name: string;
  type: BType;
  createBlock: CreateBlock<Extract<DashboardBlockInterface, { type: BType }>>;
};

export const BLOCK_TYPE_INFO: {
  [k in DashboardBlockType]: BlockTypeInfo<k>;
} = {
  markdown: {
    name: "Custom Markdown",
    type: "markdown",
    createBlock: ({ initialValues }) => ({
      type: "markdown",
      title: "",
      description: "",
      content: "",
      ...(initialValues || {}),
    }),
  },
  "metadata-description": {
    name: "Experiment Description",
    type: "metadata-description",
    createBlock: ({ initialValues, experiment }) => ({
      type: "metadata-description",
      title: "",
      description: "",
      experimentId: experiment.id,
      ...(initialValues || {}),
    }),
  },
  "metadata-hypothesis": {
    name: "Experiment Hypothesis",
    type: "metadata-hypothesis",
    createBlock: ({ initialValues, experiment }) => ({
      type: "metadata-hypothesis",
      title: "",
      description: "",
      experimentId: experiment.id,
      ...(initialValues || {}),
    }),
  },
  "variation-image": {
    name: "Variations / Screenshots",
    type: "variation-image",
    createBlock: ({ initialValues, experiment }) => ({
      type: "variation-image",
      title: "",
      description: "",
      variationIds: [],
      experimentId: experiment.id,
      ...(initialValues || {}),
    }),
  },
  metric: {
    name: "Metric Results",
    type: "metric",
    createBlock: ({ initialValues, experiment }) => ({
      type: "metric",
      title: "",
      description: "",
      experimentId: experiment.id,
      metricIds: experiment.goalMetrics,
      snapshotId: experiment.analysisSummary?.snapshotId || "",
      differenceType: "relative",
      baselineRow: 0,
      columnsFilter: [],
      ...(initialValues || {}),
    }),
  },
  dimension: {
    name: "Dimension Results",
    type: "dimension",
    createBlock: ({ initialValues, experiment }) => ({
      type: "dimension",
      title: "",
      description: "",
      experimentId: experiment.id,
      metricIds: experiment.goalMetrics,
      dimensionId: "",
      snapshotId: experiment.analysisSummary?.snapshotId || "",
      differenceType: "relative",
      baselineRow: 0,
      columnsFilter: [],
      ...(initialValues || {}),
    }),
  },
  "time-series": {
    name: "Time Series",
    type: "time-series",
    createBlock: ({ initialValues, experiment }) => ({
      type: "time-series",
      title: "",
      description: "",
      experimentId: experiment.id,
      metricId: experiment.goalMetrics[0] || "",
      snapshotId: experiment.analysisSummary?.snapshotId || "",
      variationIds: experiment.variations.map((variation) => variation.id),
      ...(initialValues || {}),
    }),
  },
  "traffic-graph": {
    name: "Traffic over Time",
    type: "traffic-graph",
    createBlock: ({ initialValues, experiment }) => ({
      type: "traffic-graph",
      title: "",
      description: "",
      experimentId: experiment.id,
      ...(initialValues || {}),
    }),
  },
  "traffic-table": {
    name: "Traffic",
    type: "traffic-table",
    createBlock: ({ initialValues, experiment }) => ({
      type: "traffic-table",
      title: "",
      description: "",
      experimentId: experiment.id,
      ...(initialValues || {}),
    }),
  },
  "sql-explorer": {
    name: "SQL Explorer",
    type: "sql-explorer",
    createBlock: ({ initialValues }) => ({
      type: "sql-explorer",
      title: "",
      description: "",
      dataVizConfigIndex: 0,
      ...(initialValues || {}),
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
  forceToEditing,
}: {
  trigger: React.ReactNode;
  addBlockType: (bType: DashboardBlockType) => void;
  forceToEditing?: () => void;
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
  blocks: DashboardBlockData<DashboardBlockInterface>[];
  canEdit: boolean;
  isEditing: boolean;
  editingBlock: number | undefined;
  enableAutoUpdates: boolean;
  setBlocks: React.Dispatch<DashboardBlockData<DashboardBlockInterface>[]>;
  forceToEditing: () => void;
  setEditingBlock: React.Dispatch<number | undefined>;
  mutate: () => void;
}

export default function DashboardEditor({
  experiment,
  blocks,
  canEdit,
  isEditing,
  editingBlock,
  enableAutoUpdates,
  setBlocks,
  forceToEditing,
  setEditingBlock,
  mutate,
}: Props) {
  const blockRefs = useRef<Array<HTMLDivElement | null>>([]);
  // Variable outside of the react lifecycle to enable scrolling only after the blocks are updated
  const scrollToBlockIndex = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (isDefined(scrollToBlockIndex.current)) {
      const el = blockRefs.current[scrollToBlockIndex.current];
      if (el) {
        window.scrollTo({
          top: el.offsetTop + 200,
          behavior: "smooth",
        });
      }
      scrollToBlockIndex.current = undefined;
    }
  }, [blocks]);

  const [editingBlockClone, setEditingBlockClone] = useState<
    DashboardBlockData<DashboardBlockInterface> | undefined
  >(undefined);

  useEffect(() => {
    setEditingBlockClone(
      isDefined(editingBlock) ? blocks[editingBlock] : undefined
    );
  }, [editingBlock, blocks]);

  const addBlockType = (bType: DashboardBlockType, index?: number) => {
    index = index ?? blocks.length;
    scrollToBlockIndex.current = index;
    setBlocks([
      ...blocks.slice(0, index),
      BLOCK_TYPE_INFO[bType].createBlock({
        experiment,
      }),
      ...blocks.slice(index),
    ]);
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
            forceToEditing={forceToEditing}
          />
        )}
      </Flex>
    );
  }

  return (
    <>
      <div className="mt-3">
        <Flex align="center" justify="between">
          <Flex align="center" mb="2" gap="1">
            {isEditing && (
              <AddBlockDropdown
                trigger={
                  <Button
                    className={clsx({
                      "dashboard-disabled": isDefined(editingBlock),
                    })}
                    icon={<PiCaretDownFill />}
                    iconPosition="right"
                    size="xs"
                  >
                    Add block
                  </Button>
                }
                addBlockType={(bType) => addBlockType(bType, blocks.length)}
              />
            )}
          </Flex>
          <DashboardUpdateDisplay
            blocks={blocks}
            enableAutoUpdates={enableAutoUpdates}
            disabled={isDefined(editingBlock)}
          />
        </Flex>
        <div className="">
          {blocks.map((block, i) => (
            <Flex
              direction="column"
              key={i}
              ref={(el) => (blockRefs.current[i] = el)}
            >
              <DashboardBlock
                // Show in-progress edits directly on the block
                block={i === editingBlock ? editingBlockClone ?? block : block}
                experiment={experiment}
                isEditing={isEditing}
                editingBlock={editingBlock === i}
                disableBlock={(editingBlock ?? i) !== i}
                setBlock={(blockData) => {
                  setBlocks([
                    ...blocks.slice(0, i),
                    { ...block, ...blockData },
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
                          "dashboard-disabled": isDefined(editingBlock),
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
        cancel={() => {
          setEditingBlock(undefined);
        }}
        submit={() => {
          if (editingBlock === undefined || editingBlockClone === undefined)
            return;
          setBlocks([
            ...blocks.slice(0, editingBlock),
            editingBlockClone,
            ...blocks.slice(editingBlock + 1),
          ]);
          setEditingBlock(undefined);
        }}
        block={editingBlockClone}
        setBlock={setEditingBlockClone}
      />
    </>
  );
}
