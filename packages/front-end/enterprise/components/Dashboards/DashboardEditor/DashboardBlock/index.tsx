import React, { useContext, useEffect, useRef, useState } from "react";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import {
  DashboardBlockInterface,
  DashboardBlockType,
  DashboardBlockInterfaceOrData,
} from "back-end/src/enterprise/validators/dashboard-block";
import { Flex, IconButton, Text } from "@radix-ui/themes";
import { PiCaretDown, PiCaretUp, PiDotsSixVertical } from "react-icons/pi";
import clsx from "clsx";
import { blockHasFieldOfType } from "shared/enterprise";
import { isNumber, isString, isStringArray } from "back-end/src/util/types";
import {
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotInterface,
} from "back-end/types/experiment-snapshot";
import { SavedQuery } from "back-end/src/validators/saved-queries";
import { SSRPolyfills } from "@/hooks/useSSRPolyfills";
import Button from "@/components/Radix/Button";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/Radix/DropdownMenu";
import { useExperiments } from "@/hooks/useExperiments";
import {
  DashboardSnapshotContext,
  useDashboardSnapshot,
} from "@/enterprise/components/Dashboards/DashboardSnapshotProvider";
import { useDefinitions } from "@/services/DefinitionsContext";
import useApi from "@/hooks/useApi";
import { BLOCK_TYPE_INFO } from "..";
import MarkdownBlock from "./MarkdownBlock";
import DescriptionBlock from "./DescriptionBlock";
import MetricBlock from "./MetricBlock";
import VariationImageBlock from "./VariationImageBlock";
import DimensionBlock from "./DimensionBlock";
import TimeSeriesBlock from "./TimeSeriesBlock";
import HypothesisBlock from "./HypothesisBlock";
import TrafficGraphBlock from "./TrafficGraphBlock";
import TrafficTableBlock from "./TrafficTableBlock";
import SqlExplorerBlock from "./SqlExplorerBlock";
import {
  BlockLoadingSnapshot,
  BlockMissingExperiment,
  BlockNeedsConfiguration,
  BlockMetricsInvalid,
  BlockMissingData,
  BlockMissingHealthCheck,
  BlockMissingSavedQuery,
} from "./BlockErrorStates";

export type BlockProps<T extends DashboardBlockInterface> = {
  block: DashboardBlockInterfaceOrData<T>;
  setBlock: React.Dispatch<DashboardBlockInterfaceOrData<T>>;
  experiment: ExperimentInterfaceStringDates;
  snapshot: ExperimentSnapshotInterface;
  analysis: ExperimentSnapshotAnalysis;
  mutate: () => void;
  isEditing: boolean;
  ssrPolyfills?: SSRPolyfills;
};

interface Props {
  block: DashboardBlockInterfaceOrData<DashboardBlockInterface>;
  dashboardExperiment: ExperimentInterfaceStringDates;
  isEditing: boolean;
  editingBlock: boolean;
  disableBlock: boolean;
  isFirstBlock: boolean;
  isLastBlock: boolean;
  setBlock: React.Dispatch<
    DashboardBlockInterfaceOrData<DashboardBlockInterface>
  >;
  editBlock: () => void;
  duplicateBlock: () => void;
  deleteBlock: () => void;
  moveBlock: (direction: 1 | -1) => void;
  mutate: () => void;
}

const BLOCK_COMPONENTS: {
  [K in DashboardBlockType]: React.FC<BlockProps<DashboardBlockInterface>>;
} = {
  markdown: MarkdownBlock,
  "metadata-description": DescriptionBlock,
  "metadata-hypothesis": HypothesisBlock,
  "variation-image": VariationImageBlock,
  metric: MetricBlock,
  dimension: DimensionBlock,
  "time-series": TimeSeriesBlock,
  "traffic-graph": TrafficGraphBlock,
  "traffic-table": TrafficTableBlock,
  "sql-explorer": SqlExplorerBlock,
};

export default function DashboardBlock({
  block,
  dashboardExperiment,
  isEditing,
  editingBlock,
  disableBlock,
  isFirstBlock,
  isLastBlock,
  setBlock,
  editBlock,
  duplicateBlock,
  deleteBlock,
  moveBlock,
  mutate,
}: Props) {
  const { experimentsMap } = useExperiments();
  const { getExperimentMetricById } = useDefinitions();
  const blockHasExperiment = blockHasFieldOfType(
    block,
    "experimentId",
    isString
  );
  const blockExperiment = blockHasExperiment
    ? experimentsMap.get(block.experimentId)
    : undefined;
  const blockHasMetric = blockHasFieldOfType(block, "metricId", isString);
  const blockMetric = blockHasMetric
    ? getExperimentMetricById(block.metricId)
    : undefined;
  const blockHasSavedQuery = blockHasFieldOfType(
    block,
    "savedQueryId",
    isString
  );
  const [moveBlockOpen, setMoveBlockOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const BlockComponent = BLOCK_COMPONENTS[block.type];
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollToBlock = () => {
    if (scrollRef.current) {
      window.scrollTo(0, scrollRef.current.offsetTop + 250);
    }
  };
  useEffect(() => {
    if (editingBlock) setTimeout(() => scrollToBlock(), 100);
  }, [editingBlock]);

  const {
    snapshot,
    analysis,
    loading: dashboardSnapshotLoading,
  } = useDashboardSnapshot(block, setBlock);
  const { savedQueriesMap, loading: dashboardContextLoading } = useContext(
    DashboardSnapshotContext
  );
  const savedQueryFromMap = blockHasSavedQuery
    ? savedQueriesMap.get(block.savedQueryId)
    : undefined;
  // Use the API directly when the saved query hasn't been attached to the dashboard yet (when editing)
  const shouldRun = () => blockHasSavedQuery && !savedQueryFromMap;
  const { data: savedQueryData, isLoading: savedQueryLoading } = useApi<{
    status: number;
    savedQuery: SavedQuery;
  }>(`/saved-queries/${blockHasSavedQuery ? block.savedQueryId : ""}`, {
    shouldRun,
  });
  const blockSavedQuery = savedQueryFromMap ?? savedQueryData?.savedQuery;

  const blockNeedsConfiguration =
    (blockHasFieldOfType(block, "metricIds", isStringArray) &&
      block.metricIds.length === 0) ||
    (blockHasFieldOfType(block, "dimensionId", isString) &&
      block.dimensionId.length === 0) ||
    (blockHasMetric && block.metricId.length === 0) ||
    (blockHasSavedQuery && block.savedQueryId.length === 0) ||
    (blockHasFieldOfType(block, "dataVizConfigIndex", isNumber) &&
      (block.dataVizConfigIndex === -1 ||
        !blockSavedQuery?.dataVizConfig?.[block.dataVizConfigIndex]));

  const blockMetricsInvalid =
    (blockHasFieldOfType(block, "metricIds", isStringArray) &&
      !!block.metricIds.find(
        (metricId) => !getExperimentMetricById(metricId)
      )) ||
    (blockHasMetric && !blockMetric);

  const blockMissingHealthCheck =
    block.type === "traffic-graph" && !snapshot?.health?.traffic;

  return (
    <Flex
      ref={scrollRef}
      className={clsx("appbox px-4 py-3 position-relative", {
        "border-violet": editingBlock,
        "dashboard-disabled": disableBlock,
      })}
      direction="column"
    >
      {isEditing && (
        <DropdownMenu
          open={moveBlockOpen}
          onOpenChange={setMoveBlockOpen}
          disabled={disableBlock || editingBlock}
          trigger={
            <IconButton
              className="position-absolute"
              style={{
                top: 20,
                left: 6,
              }}
              variant="ghost"
            >
              <PiDotsSixVertical />
            </IconButton>
          }
        >
          <DropdownMenuItem
            disabled={isFirstBlock}
            onClick={() => {
              moveBlock(-1);
              setMoveBlockOpen(false);
            }}
          >
            <Text>
              <PiCaretUp /> Move up
            </Text>
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={isLastBlock}
            onClick={() => {
              moveBlock(1);
              setMoveBlockOpen(false);
            }}
          >
            <Text>
              <PiCaretDown /> Move down
            </Text>
          </DropdownMenuItem>
        </DropdownMenu>
      )}
      <Flex align="center" justify="between">
        <h4 style={{ margin: 0 }}>
          {BLOCK_TYPE_INFO[block.type].hideTitle
            ? null
            : block.title
            ? block.title
            : isEditing
            ? BLOCK_TYPE_INFO[block.type].name
            : ""}
        </h4>

        {isEditing && (
          <div>
            {editingBlock ? (
              <Text size="1" color="gray">
                Editing
              </Text>
            ) : (
              <DropdownMenu
                open={editOpen}
                onOpenChange={setEditOpen}
                trigger={
                  <Button
                    icon={<PiCaretDown />}
                    iconPosition="right"
                    variant="ghost"
                    size="xs"
                  >
                    Edit
                  </Button>
                }
              >
                <DropdownMenuItem
                  onClick={() => {
                    editBlock();
                    setEditOpen(false);
                  }}
                >
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    duplicateBlock();
                    setEditOpen(false);
                  }}
                >
                  Duplicate
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => {
                    deleteBlock();
                    setEditOpen(false);
                  }}
                >
                  <Text color="red">Delete</Text>
                </DropdownMenuItem>
              </DropdownMenu>
            )}
          </div>
        )}
      </Flex>
      <Text>{block.description}</Text>

      {/* Check for possible error states to ensure block component has all necessary data */}
      {dashboardSnapshotLoading ||
      dashboardContextLoading ||
      (blockHasSavedQuery && savedQueryLoading) ? (
        <BlockLoadingSnapshot />
      ) : blockHasExperiment && !blockExperiment ? (
        <BlockMissingExperiment block={block} />
      ) : blockNeedsConfiguration ? (
        <BlockNeedsConfiguration block={block} />
      ) : blockMetricsInvalid ? (
        <BlockMetricsInvalid block={block} />
      ) : !snapshot || !analysis || !analysis.results[0] ? (
        <BlockMissingData />
      ) : blockMissingHealthCheck ? (
        <BlockMissingHealthCheck />
      ) : blockHasSavedQuery ? (
        !blockSavedQuery ? (
          <BlockMissingSavedQuery block={block} />
        ) : (
          <SqlExplorerBlock
            block={block}
            setBlock={setBlock}
            isEditing={isEditing}
            experiment={
              blockHasExperiment ? blockExperiment! : dashboardExperiment
            }
            snapshot={snapshot}
            analysis={analysis}
            savedQuery={blockSavedQuery}
            mutate={mutate}
          />
        )
      ) : (
        <BlockComponent
          block={block}
          setBlock={setBlock}
          isEditing={isEditing}
          experiment={
            blockHasExperiment ? blockExperiment! : dashboardExperiment
          }
          snapshot={snapshot}
          analysis={analysis}
          mutate={mutate}
        />
      )}
    </Flex>
  );
}
