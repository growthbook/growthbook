import React, { useContext, useEffect, useRef, useState } from "react";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import {
  DashboardBlockInterface,
  DashboardBlockInterfaceOrData,
} from "back-end/src/enterprise/validators/dashboard-block";
import { Flex, IconButton, Text } from "@radix-ui/themes";
import { PiCaretDown, PiCaretUp, PiDotsSixVertical } from "react-icons/pi";
import clsx from "clsx";
import { blockHasFieldOfType } from "shared/enterprise";
import {
  isNumber,
  isString,
  isStringArray,
  partialToFull,
  isDefined,
} from "shared/util";
import {
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotInterface,
} from "back-end/types/experiment-snapshot";
import { SavedQuery } from "back-end/src/validators/saved-queries";
import {
  expandMetricGroups,
  ExperimentMetricInterface,
} from "shared/experiments";
import { ErrorBoundary } from "@sentry/react";
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
  BlockNeedsConfiguration,
  BlockMissingData,
  BlockMissingHealthCheck,
  BlockObjectMissing,
  BlockRenderError,
} from "./BlockErrorStates";

// Typescript helpers for passing objects to the block components based on id fields
interface BlockIdFieldToObjectMap {
  experimentId: ExperimentInterfaceStringDates;
  metricId: ExperimentMetricInterface;
  metricIds: ExperimentMetricInterface[];
  savedQueryId: SavedQuery;
}
type ObjectProps<Block> = {
  [K in keyof BlockIdFieldToObjectMap as K extends keyof Block
    ? // Formatting to strip the trailing Id or Ids so metricId: string becomes metric: ExperimentMetricInterface
      K extends `${infer Base}Id`
      ? Base
      : K extends `${infer Base}Ids`
      ? `${Base}s`
      : never
    : never]: BlockIdFieldToObjectMap[K];
};

export type BlockProps<T extends DashboardBlockInterface> = {
  block: DashboardBlockInterfaceOrData<T>;
  setBlock: React.Dispatch<DashboardBlockInterfaceOrData<T>>;
  snapshot: ExperimentSnapshotInterface;
  analysis: ExperimentSnapshotAnalysis;
  mutate: () => void;
  isEditing: boolean;
  ssrPolyfills?: SSRPolyfills;
} & ObjectProps<T>;

interface Props<DashboardBlock extends DashboardBlockInterface> {
  block: DashboardBlockInterfaceOrData<DashboardBlock>;
  dashboardExperiment: ExperimentInterfaceStringDates;
  isEditing: boolean;
  editingBlock: boolean;
  disableBlock: boolean;
  isFirstBlock: boolean;
  isLastBlock: boolean;
  setBlock: React.Dispatch<DashboardBlockInterfaceOrData<DashboardBlock>>;
  editBlock: () => void;
  duplicateBlock: () => void;
  deleteBlock: () => void;
  moveBlock: (direction: 1 | -1) => void;
  mutate: () => void;
}

const BLOCK_COMPONENTS: {
  [B in DashboardBlockInterface as B["type"]]: React.FC<BlockProps<B>>;
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

export default function DashboardBlock<T extends DashboardBlockInterface>({
  block,
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
}: Props<T>) {
  const { experimentsMap, loading: experimentsLoading } = useExperiments();
  const {
    getExperimentMetricById,
    metricGroups,
    ready: definitionsReady,
  } = useDefinitions();
  const [moveBlockOpen, setMoveBlockOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const {
    snapshot,
    analysis,
    loading: dashboardSnapshotLoading,
  } = useDashboardSnapshot(block, setBlock);
  const { savedQueriesMap, loading: dashboardContextLoading } = useContext(
    DashboardSnapshotContext
  );
  const blockHasSavedQuery = blockHasFieldOfType(
    block,
    "savedQueryId",
    isString
  );
  // Use the API directly when the saved query hasn't been attached to the dashboard yet (when editing)
  const shouldRun = () =>
    blockHasSavedQuery && !savedQueriesMap.has(block.savedQueryId);
  const { data: savedQueryData, isLoading: savedQueryLoading } = useApi<{
    status: number;
    savedQuery: SavedQuery;
  }>(`/saved-queries/${blockHasSavedQuery ? block.savedQueryId : ""}`, {
    shouldRun,
  });

  const BlockComponent = BLOCK_COMPONENTS[block.type] as React.FC<
    BlockProps<T>
  >;

  // Get objects referenced by ID so the block component doesn't need to handle them being missing
  let objectProps: Partial<ObjectProps<T>> = {};
  const blockHasExperiment = blockHasFieldOfType(
    block,
    "experimentId",
    isString
  );
  const blockExperiment = blockHasExperiment
    ? experimentsMap.get(block.experimentId)
    : undefined;
  if (blockHasExperiment) {
    objectProps = { ...objectProps, experiment: blockExperiment };
  }
  const blockHasMetric = blockHasFieldOfType(block, "metricId", isString);
  const blockMetric = blockHasMetric
    ? getExperimentMetricById(block.metricId)
    : undefined;
  if (blockHasMetric) {
    objectProps = { ...objectProps, metric: blockMetric };
  }
  const blockHasMetrics = blockHasFieldOfType(
    block,
    "metricIds",
    isStringArray
  );
  const blockMetrics = blockHasMetrics
    ? expandMetricGroups(block.metricIds, metricGroups).map(
        getExperimentMetricById
      )
    : undefined;
  if (blockHasMetrics) {
    objectProps = { ...objectProps, metrics: blockMetrics };
  }
  const blockSavedQuery = blockHasSavedQuery
    ? savedQueriesMap.get(block.savedQueryId) ?? savedQueryData?.savedQuery
    : undefined;
  if (blockHasSavedQuery) {
    objectProps = {
      ...objectProps,
      savedQuery: blockSavedQuery,
    };
  }

  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollToBlock = () => {
    if (scrollRef.current) {
      window.scrollTo(0, scrollRef.current.offsetTop + 250);
    }
  };
  useEffect(() => {
    if (editingBlock) setTimeout(() => scrollToBlock(), 100);
  }, [editingBlock]);

  const blockNeedsConfiguration =
    (blockHasFieldOfType(block, "metricIds", isStringArray) &&
      block.metricIds.length === 0) ||
    (blockHasFieldOfType(block, "dimensionId", isString) &&
      block.dimensionId.length === 0) ||
    (blockHasMetric && block.metricId.length === 0) ||
    (blockHasSavedQuery &&
      (block.savedQueryId.length === 0 || !blockSavedQuery)) ||
    (blockHasFieldOfType(block, "dataVizConfigIndex", isNumber) &&
      (block.dataVizConfigIndex === -1 ||
        !blockSavedQuery?.dataVizConfig?.[block.dataVizConfigIndex]));

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
      {!definitionsReady ||
      experimentsLoading ||
      dashboardSnapshotLoading ||
      dashboardContextLoading ||
      (blockHasSavedQuery && savedQueryLoading) ? (
        <BlockLoadingSnapshot />
      ) : blockNeedsConfiguration ? (
        <BlockNeedsConfiguration block={block} />
      ) : !snapshot || !analysis || !analysis.results[0] ? (
        <BlockMissingData />
      ) : blockMissingHealthCheck ? (
        <BlockMissingHealthCheck />
      ) : Object.keys(objectProps).some(
          (key) =>
            !isDefined(objectProps[key]) ||
            (Array.isArray(objectProps[key]) &&
              objectProps[key].some((el) => !isDefined(el)))
        ) ? (
        <BlockObjectMissing block={block} />
      ) : (
        <ErrorBoundary fallback={<BlockRenderError block={block} />}>
          <BlockComponent
            block={block}
            setBlock={setBlock}
            isEditing={isEditing}
            snapshot={snapshot}
            analysis={analysis}
            mutate={mutate}
            {...partialToFull(objectProps)}
          />
        </ErrorBoundary>
      )}
    </Flex>
  );
}
