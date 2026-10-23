import React, { useContext } from "react";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import {
  DashboardBlockInterface,
  DashboardBlockInterfaceOrData,
  blockHasFieldOfType,
  DashboardInterface,
} from "shared/enterprise";
import { isNumber, isString, isDefined } from "shared/util";
import {
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotInterface,
} from "shared/types/experiment-snapshot";
import { SavedQuery } from "shared/validators";
import {
  expandMetricGroups,
  ExperimentMetricDefinition,
} from "shared/experiments";
import { ErrorBoundary } from "@sentry/nextjs";
import { MetricAnalysisInterface } from "shared/types/metric-analysis";
import { FactMetricInterface } from "shared/types/fact-table";
import { SSRPolyfills } from "@/hooks/useSSRPolyfills";
import { useExperiments } from "@/hooks/useExperiments";
import {
  DashboardSnapshotContext,
  useDashboardMetricAnalysis,
  useDashboardSnapshot,
} from "@/enterprise/components/Dashboards/DashboardSnapshotProvider";
import { useDefinitions } from "@/services/DefinitionsContext";
import useApi from "@/hooks/useApi";
import { isSubmittableConfig } from "@/enterprise/components/ProductAnalytics/util";
import MarkdownBlock from "./MarkdownBlock";
import ExperimentMetadataBlock from "./ExperimentMetadataBlock";
import ExperimentMetricBlock from "./ExperimentMetricBlock";
import MetricExperimentsBlock from "./MetricExperimentsBlock";
import ExperimentsScaledImpactBlock from "./ExperimentsScaledImpactBlock";
import ExperimentsWinRateBlock from "./ExperimentsWinRateBlock";
import ExperimentsStatusBlock from "./ExperimentsStatusBlock";
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
import ProductAnalyticsExplorerBlock from "./ProductAnalyticsExplorerBlock";

// Typescript helpers for passing objects to the block components based on id fields
interface BlockIdFieldToObjectMap {
  experimentId: ExperimentInterfaceStringDates;
  metricIds: ExperimentMetricDefinition[];
  factMetricId: FactMetricInterface;
  savedQueryId: SavedQuery;
  metricAnalysisId: MetricAnalysisInterface;
}
type ObjectProps<Block> = {
  [K in keyof BlockIdFieldToObjectMap as K extends keyof Block
    ? // Formatting to strip the trailing Id or Ids so metricId: string becomes metric: ExperimentMetricDefinition
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
  dashboardGlobalControls?: DashboardInterface["globalControls"];
  dashboardComparison?: DashboardInterface["comparison"];
  blockIndex?: number;
  setBlock: undefined | React.Dispatch<DashboardBlockInterfaceOrData<T>>;
  snapshot: ExperimentSnapshotInterface;
  analysis: ExperimentSnapshotAnalysis;
  isEditing: boolean;
  ssrPolyfills?: SSRPolyfills;
} & ObjectProps<T>;

const BLOCK_COMPONENTS: {
  [B in DashboardBlockInterface as B["type"]]: React.FC<BlockProps<B>>;
} = {
  markdown: MarkdownBlock,
  "experiment-metadata": ExperimentMetadataBlock,
  "experiment-metric": ExperimentMetricBlock,
  "metric-experiments": MetricExperimentsBlock,
  "experiments-scaled-impact": ExperimentsScaledImpactBlock,
  "experiments-win-rate": ExperimentsWinRateBlock,
  "experiments-status": ExperimentsStatusBlock,
  "experiment-dimension": ExperimentDimensionBlock,
  "experiment-time-series": ExperimentTimeSeriesBlock,
  "experiment-traffic": ExperimentTrafficBlock,
  "sql-explorer": SqlExplorerBlock,
  "metric-explorer": MetricExplorerBlock,
  "metric-exploration": ProductAnalyticsExplorerBlock,
  "fact-table-exploration": ProductAnalyticsExplorerBlock,
  "data-source-exploration": ProductAnalyticsExplorerBlock,
  "sql-exploration": ProductAnalyticsExplorerBlock,
  "funnel-exploration": ProductAnalyticsExplorerBlock,
};

export default function DashboardBlockContent<
  T extends DashboardBlockInterface,
>({
  isTabActive = true,
  block,
  dashboardGlobalControls,
  dashboardComparison,
  blockIndex,
  setBlock,
  isEditing = false,
}: {
  isTabActive?: boolean;
  block: DashboardBlockInterfaceOrData<T>;
  dashboardGlobalControls?: DashboardInterface["globalControls"];
  dashboardComparison?: DashboardInterface["comparison"];
  blockIndex?: number;
  setBlock?: React.Dispatch<DashboardBlockInterfaceOrData<T>>;
  isEditing?: boolean;
}) {
  const { experimentsMap, loading: experimentsLoading } = useExperiments();
  const {
    getExperimentMetricById,
    metricGroups,
    getFactMetricById,
    ready: definitionsReady,
  } = useDefinitions();
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
    // TypeScript needs help here - blockHasMetrics narrows the type but TS can't infer it
    const blockWithMetrics = block as Extract<T, { metricIds: string[] }>;
    const blockMetricIds = blockWithMetrics.metricIds;
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
      (block.metricAnalysisId.length === 0 || !metricAnalysis)) ||
    ((block.type === "metric-exploration" ||
      block.type === "fact-table-exploration" ||
      block.type === "data-source-exploration" ||
      block.type === "sql-exploration" ||
      block.type === "funnel-exploration") &&
      !isSubmittableConfig(block.config));

  const blockMissingHealthCheck =
    block.type === "experiment-traffic" &&
    block.showTimeseries &&
    !snapshot?.health?.traffic;

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

  return (
    <>
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
            dashboardGlobalControls={dashboardGlobalControls}
            dashboardComparison={dashboardComparison}
            blockIndex={blockIndex}
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
            // objectProps should be validated above to actually contain all the keys and not be Partial
            {...(objectProps as unknown as ObjectProps<T>)}
          />
        </ErrorBoundary>
      )}
    </>
  );
}
