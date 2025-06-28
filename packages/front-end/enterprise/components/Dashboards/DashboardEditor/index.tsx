import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import React, { Fragment, useEffect, useMemo, useState } from "react";
import { PiCaretDownFill, PiPlus } from "react-icons/pi";
import {
  DashboardInstanceInterface,
  DashboardSettingsInterface,
} from "back-end/src/enterprise/validators/dashboard-instance";
import {
  DashboardBlockData,
  DashboardBlockInterface,
  DashboardBlockType,
} from "back-end/src/enterprise/validators/dashboard-block";
import { debounce } from "lodash";
import { isDefined } from "shared/util";
import { Flex, Heading, IconButton, Text } from "@radix-ui/themes";
import Button from "@/components/Radix/Button";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/Radix/DropdownMenu";
import DashboardSnapshotProvider from "../DashboardSnapshotProvider";
import { SubmitDashboard } from "../DashboardsTab";
import DashboardBlock from "./DashboardBlock";

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
    createDefaultBlock: () => ({ type: "markdown", content: "" }),
  },
  "metadata-description": {
    name: "Description",
    createDefaultBlock: ({ experiment }) => ({
      type: "metadata-description",
      experimentId: experiment.id,
    }),
  },
  "metadata-hypothesis": {
    name: "Hypothesis",
    createDefaultBlock: ({ experiment }) => ({
      type: "metadata-hypothesis",
      experimentId: experiment.id,
    }),
  },
  "variation-image": {
    name: "Variations / Screenshots",
    createDefaultBlock: ({ experiment }) => ({
      type: "variation-image",
      variationIds: [],
      experimentId: experiment.id,
    }),
  },
  metric: {
    name: "Overall results",
    createDefaultBlock: ({ experiment }) => ({
      type: "metric",
      experimentId: experiment.id,
      snapshotId: experiment.analysisSummary?.snapshotId || "",
    }),
  },
  dimension: {
    name: "Dimension results",
    createDefaultBlock: ({ experiment }) => ({
      type: "dimension",
      experimentId: experiment.id,
      snapshotId: experiment.analysisSummary?.snapshotId || "",
    }),
  },
  "time-series": {
    name: "Time Series",
    createDefaultBlock: ({ experiment }) => ({
      type: "time-series",
      experimentId: experiment.id,
      metricId: "",
      snapshotId: experiment.analysisSummary?.snapshotId || "",
    }),
  },
  "traffic-graph": {
    name: "Traffic over Time",
    createDefaultBlock: ({ experiment }) => ({
      type: "traffic-graph",
      experimentId: experiment.id,
    }),
  },
  "traffic-table": {
    name: "Traffic",
    createDefaultBlock: ({ experiment }) => ({
      type: "traffic-table",
      experimentId: experiment.id,
    }),
  },
  "sql-explorer": {
    name: "SQL Explorer",
    createDefaultBlock: () => ({
      type: "sql-explorer",
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
}: {
  trigger: React.ReactNode;
  addBlockType: (bType: DashboardBlockType) => void;
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
  dashboard?: DashboardInstanceInterface;
  defaultSettings: DashboardSettingsInterface;
  submitCallback: SubmitDashboard;
  isEditing: boolean;
  mutate: () => void;
}

export default function DashboardEditor({
  experiment,
  dashboard,
  submitCallback,
  isEditing,
  mutate,
}: Props) {
  const [blocks, setBlocks] = useState<
    DashboardBlockData<DashboardBlockInterface>[]
  >(dashboard?.blocks || []);
  const [dirty, setDirty] = useState(false);

  const setBlocksAndDirty = useMemo(
    () => (
      blocks: (DashboardBlockData<DashboardBlockInterface> | undefined)[]
    ) => {
      setBlocks(blocks.filter(isDefined));
      setDirty(true);
    },
    [setBlocks, setDirty]
  );

  const debouncedSubmit = useMemo(() => {
    return debounce(
      async (blocks: DashboardBlockData<DashboardBlockInterface>[]) => {
        await submitCallback({ blocks });
        setDirty(false);
      },
      2000
    );
  }, [submitCallback]);

  useEffect(() => {
    if (isEditing && dirty) {
      debouncedSubmit(blocks);
    }
  }, [isEditing, dirty, debouncedSubmit, blocks]);

  const addBlockType = (bType: DashboardBlockType, index?: number) => {
    index = index ?? blocks.length;
    setDirty(true);
    setBlocks([
      ...blocks.slice(0, index),
      BLOCK_TYPE_INFO[bType].createDefaultBlock({
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
        <AddBlockDropdown
          addBlockType={addBlockType}
          trigger={
            <Button icon={<PiCaretDownFill />} iconPosition="right">
              Add block
            </Button>
          }
        />
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
                  <Button icon={<PiCaretDownFill />} iconPosition="right">
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
                setBlock={(block: DashboardBlockInterface) => {
                  setBlocksAndDirty(
                    blocks.map((b, j) => (j === i ? block : b))
                  );
                }}
                mutate={mutate}
              />
              {isEditing && (
                <Flex justify="center" mb="2">
                  <AddBlockDropdown
                    trigger={
                      <IconButton size="1">
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
    </DashboardSnapshotProvider>
  );
}
