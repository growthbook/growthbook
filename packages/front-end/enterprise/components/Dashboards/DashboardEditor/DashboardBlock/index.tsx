import React, { useContext, useEffect, useRef, useState } from "react";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import {
  DashboardBlockInterface,
  DashboardBlockInterfaceOrData,
  blockHasFieldOfType,
} from "shared/enterprise";
import { Flex, IconButton, Text } from "@radix-ui/themes";
import {
  PiCaretDown,
  PiCaretUp,
  PiCaretUpDown,
  PiPencilSimpleFill,
} from "react-icons/pi";
import clsx from "clsx";
import { isNumber, isString, isDefined } from "shared/util";
import {
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotInterface,
} from "shared/types/experiment-snapshot";
import { SavedQuery } from "shared/validators";
import {
  expandMetricGroups,
  ExperimentMetricInterface,
} from "shared/experiments";
import { ErrorBoundary } from "@sentry/react";
import { BsThreeDotsVertical } from "react-icons/bs";
import { MetricAnalysisInterface } from "shared/types/metric-analysis";
import { FactMetricInterface } from "shared/types/fact-table";
import { SSRPolyfills } from "@/hooks/useSSRPolyfills";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";
import { useExperiments } from "@/hooks/useExperiments";
import {
  DashboardSnapshotContext,
  useDashboardMetricAnalysis,
  useDashboardSnapshot,
} from "@/enterprise/components/Dashboards/DashboardSnapshotProvider";
import { useDefinitions } from "@/services/DefinitionsContext";
import useApi from "@/hooks/useApi";
import Field from "@/components/Forms/Field";
import { BLOCK_TYPE_INFO } from "..";
import MarkdownBlock from "./MarkdownBlock";
import ExperimentMetadataBlock from "./ExperimentMetadataBlock";
import ExperimentMetricBlock from "./ExperimentMetricBlock";
import ExperimentDimensionBlock from "./ExperimentDimensionBlock";
import ExperimentTimeSeriesBlock from "./ExperimentTimeSeriesBlock";
import ExperimentTrafficBlock from "./ExperimentTrafficBlock";
import SqlExplorerBlock from "./SqlExplorerBlock";
import {
  BlockLoadingSnapshot,
  BlockNeedsConfiguration,
  BlockMissingData,
  BlockMissingHealthCheck,
  BlockObjectMissing,
  BlockRenderError,
} from "./BlockErrorStates";
import MetricExplorerBlock from "./MetricExplorerBlock";

// Typescript helpers for passing objects to the block components based on id fields
interface BlockIdFieldToObjectMap {
  experimentId: ExperimentInterfaceStringDates;
  metricIds: ExperimentMetricInterface[];
  factMetricId: FactMetricInterface;
  savedQueryId: SavedQuery;
  metricAnalysisId: MetricAnalysisInterface;
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
  isTabActive: boolean;
  block: DashboardBlockInterfaceOrData<T>;
  setBlock: undefined | React.Dispatch<DashboardBlockInterfaceOrData<T>>;
  snapshot: ExperimentSnapshotInterface;
  analysis: ExperimentSnapshotAnalysis;
  mutate: () => void;
  isEditing: boolean;
  ssrPolyfills?: SSRPolyfills;
} & ObjectProps<T>;

interface Props<DashboardBlock extends DashboardBlockInterface> {
  isTabActive: boolean;
  block: DashboardBlockInterfaceOrData<DashboardBlock>;
  isFocused: boolean;
  isEditing: boolean;
  editingBlock: boolean;
  disableBlock: "full" | "partial" | "none";
  isFirstBlock: boolean;
  isLastBlock: boolean;
  scrollAreaRef: null | React.MutableRefObject<HTMLDivElement | null>;
  setBlock:
    | undefined
    | React.Dispatch<DashboardBlockInterfaceOrData<DashboardBlock>>;
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
  "experiment-metadata": ExperimentMetadataBlock,
  "experiment-metric": ExperimentMetricBlock,
  "experiment-dimension": ExperimentDimensionBlock,
  "experiment-time-series": ExperimentTimeSeriesBlock,
  "experiment-traffic": ExperimentTrafficBlock,
  "sql-explorer": SqlExplorerBlock,
  "metric-explorer": MetricExplorerBlock,
};

export default function DashboardBlock<T extends DashboardBlockInterface>({
  isTabActive,
  block,
  isEditing,
  isFocused,
  editingBlock,
  disableBlock,
  isFirstBlock,
  isLastBlock,
  scrollAreaRef,
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
    getFactMetricById,
    ready: definitionsReady,
  } = useDefinitions();
  const [moveBlockOpen, setMoveBlockOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const {
    snapshot,
    analysis,
    loading: dashboardSnapshotLoading,
  } = useDashboardSnapshot(block, setBlock);
  const { savedQueriesMap, loading: dashboardContextLoading } = useContext(
    DashboardSnapshotContext,
  );
  const { metricAnalysis, loading: metricAnalysisLoading } =
    useDashboardMetricAnalysis(block, setBlock);
  const blockHasSavedQuery = blockHasFieldOfType(
    block,
    "savedQueryId",
    isString,
  );

  const [editTitle, setEditTitle] = useState(false);

  // Type guards for sql-explorer blocks
  const isSqlExplorerWithDataVizIndex = (
    b: typeof block,
  ): b is typeof block & { dataVizConfigIndex: number } => {
    return (
      b.type === "sql-explorer" &&
      blockHasFieldOfType(b, "dataVizConfigIndex", isNumber)
    );
  };

  const isSqlExplorerWithBlockConfig = (
    b: typeof block,
  ): b is typeof block & { blockConfig: string[] } => {
    return b.type === "sql-explorer" && "blockConfig" in b;
  };

  // Use the API directly when the saved query hasn't been attached to the dashboard yet (when editing)
  const shouldFetchSavedQuery = () =>
    blockHasSavedQuery && !savedQueriesMap.has(block.savedQueryId);
  const { data: savedQueryData, isLoading: savedQueryLoading } = useApi<{
    status: number;
    savedQuery: SavedQuery;
  }>(`/saved-queries/${blockHasSavedQuery ? block.savedQueryId : ""}`, {
    shouldRun: shouldFetchSavedQuery,
  });

  const blockHasMetricAnalysis = blockHasFieldOfType(
    block,
    "metricAnalysisId",
    isString,
  );
  const BlockComponent = BLOCK_COMPONENTS[block.type] as React.FC<
    BlockProps<T>
  >;

  // Get objects referenced by ID so the block component doesn't need to handle them being missing
  let objectProps: Partial<ObjectProps<T>> = {};
  const blockHasExperiment = blockHasFieldOfType(
    block,
    "experimentId",
    isString,
  );
  const blockExperiment = blockHasExperiment
    ? experimentsMap.get(block.experimentId)
    : undefined;
  if (blockHasExperiment) {
    objectProps = { ...objectProps, experiment: blockExperiment };
  }
  const blockHasMetrics = blockHasFieldOfType(
    block,
    "metricIds",
    (val): val is string[] => Array.isArray(val),
  );
  if (blockHasMetrics && blockHasExperiment) {
    // Determine base metric IDs based on selector IDs in metricIds
    const blockMetricIds = block.metricIds || [];
    const hasGoalSelector = blockMetricIds.includes("experiment-goal");
    const hasSecondarySelector = blockMetricIds.includes(
      "experiment-secondary",
    );
    const hasGuardrailSelector = blockMetricIds.includes(
      "experiment-guardrail",
    );

    let baseMetricIds: string[] = [];
    if (hasGoalSelector || hasSecondarySelector || hasGuardrailSelector) {
      // If any selector is present, include metrics from those categories
      if (hasGoalSelector) {
        baseMetricIds.push(...(blockExperiment?.goalMetrics ?? []));
      }
      if (hasSecondarySelector) {
        baseMetricIds.push(...(blockExperiment?.secondaryMetrics ?? []));
      }
      if (hasGuardrailSelector) {
        baseMetricIds.push(...(blockExperiment?.guardrailMetrics ?? []));
      }
    } else {
      // No selectors - include all metrics (equivalent to "all")
      baseMetricIds = [
        ...(blockExperiment?.goalMetrics ?? []),
        ...(blockExperiment?.secondaryMetrics ?? []),
        ...(blockExperiment?.guardrailMetrics ?? []),
      ];
    }

    let expandedMetricIds = expandMetricGroups(baseMetricIds, metricGroups);

    // Filter by actual metric IDs (excluding selector IDs)
    const actualMetricIds = blockMetricIds.filter(
      (id) =>
        ![
          "experiment-goal",
          "experiment-secondary",
          "experiment-guardrail",
        ].includes(id),
    );
    if (actualMetricIds.length > 0) {
      const filteredMetricIds = expandMetricGroups(
        actualMetricIds,
        metricGroups,
      );
      const filteredMetricIdsSet = new Set(filteredMetricIds);
      expandedMetricIds = expandedMetricIds.filter((id) =>
        filteredMetricIdsSet.has(id),
      );
    }

    const blockMetrics = expandedMetricIds
      .map(getExperimentMetricById)
      .filter(isDefined);
    objectProps = { ...objectProps, metrics: blockMetrics };
  }

  const blockSavedQuery = blockHasSavedQuery
    ? (savedQueriesMap.get(block.savedQueryId) ?? savedQueryData?.savedQuery)
    : undefined;
  if (blockHasSavedQuery) {
    objectProps = {
      ...objectProps,
      savedQuery: blockSavedQuery,
    };
  }

  if (blockHasMetricAnalysis) {
    objectProps = {
      ...objectProps,
      metricAnalysis,
    };
  }

  const blockHasFactMetric = blockHasFieldOfType(
    block,
    "factMetricId",
    isString,
  );
  const blockFactMetric = blockHasFactMetric
    ? getFactMetricById(block.factMetricId)
    : undefined;
  if (blockHasFactMetric) {
    objectProps = {
      ...objectProps,
      factMetric: blockFactMetric,
    };
  }

  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollToBlock = () => {
    if (scrollRef.current && scrollAreaRef && scrollAreaRef.current) {
      scrollAreaRef.current.scrollTo({
        left: 0,
        top: scrollRef.current.offsetTop - scrollAreaRef.current.offsetTop,
        behavior: "smooth",
      });
    }
  };
  useEffect(() => {
    if (editingBlock || isFocused) setTimeout(() => scrollToBlock(), 100);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingBlock, isFocused]);

  // Blocks with metrics don't need configuration - empty metricIds means "all metrics"
  // Selector IDs (experiment-goal, experiment-secondary, experiment-guardrail) are also valid
  const blockNeedsConfiguration =
    (blockHasFieldOfType(block, "dimensionId", isString) &&
      block.dimensionId.length === 0) ||
    (blockHasSavedQuery &&
      (block.savedQueryId.length === 0 || !blockSavedQuery)) ||
    (blockHasSavedQuery &&
      block.type === "sql-explorer" &&
      (isSqlExplorerWithDataVizIndex(block)
        ? block.dataVizConfigIndex === -1 ||
          !blockSavedQuery?.dataVizConfig?.[block.dataVizConfigIndex]
        : isSqlExplorerWithBlockConfig(block)
          ? !block.blockConfig || block.blockConfig.length === 0
          : true)) ||
    (blockHasFactMetric &&
      (block.factMetricId.length === 0 || !blockFactMetric)) ||
    (blockHasMetricAnalysis &&
      (block.metricAnalysisId.length === 0 || !metricAnalysis));

  const blockMissingHealthCheck =
    block.type === "experiment-traffic" &&
    block.showTimeseries &&
    !snapshot?.health?.traffic;

  const canEditTitle = isEditing && disableBlock === "none" && !isFocused;

  // Only experiment-result blocks require experiment snapshots/analysis.
  // Non-experiment blocks (e.g., markdown, experiment-metadata) should not show
  // "No data yet" just because there's no snapshot.
  const experimentResultBlockTypes = [
    "experiment-metric",
    "experiment-dimension",
    "experiment-time-series",
    "experiment-traffic",
  ] as const;
  const requiresSnapshot = (
    experimentResultBlockTypes as readonly string[]
  ).includes(block.type as string);

  function getDefaultValueForTitle(
    blockType: DashboardBlockInterface["type"],
  ): string {
    return blockType === "markdown" ? "" : BLOCK_TYPE_INFO[blockType].name;
  }

  return (
    <Flex
      ref={scrollRef}
      className={clsx("appbox px-4 py-3 mb-0 position-relative", {
        "border-violet": editingBlock || isFocused,
        "dashboard-disabled": disableBlock === "full",
      })}
      direction="column"
    >
      {isEditing && !editingBlock && disableBlock === "none" && (
        <div
          style={{
            position: "absolute",
            top: 45,
            left: 24,
            right: 24,
            bottom: 12,
            backgroundColor:
              "color-mix(in srgb, var(--violet-a3) 30%, transparent)",
            cursor: "pointer",
            // This will make the underlying block non-interactive
            // The user must click this overlay to enter editing mode and then they can interact
            opacity: 0.01,
            zIndex: 999,
            borderRadius: 6,
          }}
          className="fade-hover"
          onClick={(e) => {
            e.stopPropagation();
            editBlock();
          }}
        ></div>
      )}
      {isEditing && (
        <DropdownMenu
          open={moveBlockOpen}
          onOpenChange={setMoveBlockOpen}
          disabled={disableBlock === "partial"}
          trigger={
            <IconButton
              onClick={(e) => e.stopPropagation()}
              className="position-absolute"
              style={{
                top: 20,
                left: 6,
              }}
              variant="ghost"
            >
              <PiCaretUpDown />
            </IconButton>
          }
        >
          <DropdownMenuItem
            disabled={isFirstBlock}
            onClick={(e) => {
              moveBlock(-1);
              setMoveBlockOpen(false);
              e.stopPropagation();
            }}
          >
            <Text>
              <PiCaretUp /> Move up
            </Text>
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={isLastBlock}
            onClick={(e) => {
              moveBlock(1);
              setMoveBlockOpen(false);
              e.stopPropagation();
            }}
          >
            <Text>
              <PiCaretDown /> Move down
            </Text>
          </DropdownMenuItem>
        </DropdownMenu>
      )}
      <Flex align="center" mb="2" mr="3">
        {canEditTitle && editTitle && setBlock ? (
          <Field
            autoFocus
            defaultValue={block.title || getDefaultValueForTitle(block.type)}
            placeholder="Title"
            onFocus={(e) => {
              e.target.select();
            }}
            onBlur={(e) => {
              setEditTitle(false);
              const title = e.target.value;
              if (title !== block.title) {
                setBlock({ ...block, title });
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                (e.target as HTMLInputElement).blur();
              } else if (e.key === "Escape") {
                setEditTitle(false);
              }
            }}
            containerClassName="flex-1"
          />
        ) : (
          <>
            <h4
              onDoubleClick={
                canEditTitle
                  ? (e) => {
                      e.preventDefault();
                      setEditTitle(true);
                    }
                  : undefined
              }
              style={{
                margin: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                flexShrink: 1,
              }}
            >
              {block.title || getDefaultValueForTitle(block.type)}
            </h4>
            {canEditTitle && (
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  setEditTitle(true);
                }}
                className="ml-2"
                style={{ color: "var(--violet-9)" }}
                title="Edit Title"
              >
                <PiPencilSimpleFill />
              </a>
            )}

            <div style={{ flexGrow: 1, marginRight: 30 }} />
          </>
        )}

        {isEditing && (
          <div>
            {!editingBlock && (
              <DropdownMenu
                open={dropdownOpen}
                onOpenChange={setDropdownOpen}
                trigger={
                  <IconButton
                    variant="ghost"
                    size="1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span style={{ fontSize: "15px", lineHeight: "15px" }}>
                      <BsThreeDotsVertical />
                    </span>
                  </IconButton>
                }
              >
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    editBlock();
                    setDropdownOpen(false);
                  }}
                >
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    duplicateBlock();
                    setDropdownOpen(false);
                  }}
                >
                  Duplicate
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteBlock();
                    setDropdownOpen(false);
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
      metricAnalysisLoading ||
      dashboardContextLoading ||
      (blockHasSavedQuery && savedQueryLoading) ||
      (blockHasMetricAnalysis && metricAnalysisLoading) ? (
        <BlockLoadingSnapshot />
      ) : blockNeedsConfiguration ? (
        <BlockNeedsConfiguration block={block} />
      ) : requiresSnapshot &&
        (!snapshot || !analysis || !analysis.results[0]) ? (
        <BlockMissingData />
      ) : blockMissingHealthCheck ? (
        <BlockMissingHealthCheck />
      ) : Object.keys(objectProps).some(
          (key) =>
            !isDefined(objectProps[key]) ||
            (Array.isArray(objectProps[key]) &&
              objectProps[key].some((el) => !isDefined(el))),
        ) ? (
        <BlockObjectMissing block={block} />
      ) : (
        <ErrorBoundary fallback={<BlockRenderError block={block} />}>
          <BlockComponent
            isTabActive={isTabActive}
            block={block}
            setBlock={setBlock}
            isEditing={isEditing}
            snapshot={
              requiresSnapshot
                ? (snapshot as ExperimentSnapshotInterface)
                : ({} as ExperimentSnapshotInterface)
            }
            analysis={
              requiresSnapshot
                ? (analysis as ExperimentSnapshotAnalysis)
                : ({} as ExperimentSnapshotAnalysis)
            }
            mutate={mutate}
            // objectProps should be validated above to actually contain all the keys and not be Partial
            {...(objectProps as unknown as ObjectProps<T>)}
          />
        </ErrorBoundary>
      )}
    </Flex>
  );
}
