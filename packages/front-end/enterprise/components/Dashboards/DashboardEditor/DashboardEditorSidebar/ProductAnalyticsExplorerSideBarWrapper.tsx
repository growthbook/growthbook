import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  DashboardBlockInterfaceOrData,
  DashboardInterface,
  MetricExplorationBlockInterface,
  FactTableExplorationBlockInterface,
  DataSourceExplorationBlockInterface,
  getEffectiveExplorationConfig,
  restoreBlockLocalDateControls,
} from "shared/enterprise";
import type { BlockComparison } from "shared/enterprise";
import { isEqual } from "lodash";
import ExplorerSideBar from "@/enterprise/components/ProductAnalytics/SideBar/ExplorerSideBar";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import { stripExplorerDraftFields } from "@/enterprise/components/ProductAnalytics/util";

export default function ProductAnalyticsExplorerSideBarWrapper({
  block,
  setBlock,
  dashboardGlobalControls,
  invalidateStaleResults = true,
  saveAndCloseTrigger,
  onSaveAndClose,
}: {
  block: DashboardBlockInterfaceOrData<
    | MetricExplorationBlockInterface
    | FactTableExplorationBlockInterface
    | DataSourceExplorationBlockInterface
  >;
  setBlock: React.Dispatch<
    DashboardBlockInterfaceOrData<
      | MetricExplorationBlockInterface
      | FactTableExplorationBlockInterface
      | DataSourceExplorationBlockInterface
    >
  >;
  dashboardGlobalControls?: DashboardInterface["globalControls"];
  invalidateStaleResults?: boolean;
  saveAndCloseTrigger?: number;
  onSaveAndClose?: () => void;
}) {
  const {
    needsFetch,
    needsUpdate,
    draftExploreState,
    setDraftExploreState,
    handleSubmit,
    loading,
  } = useExplorerContext();
  const pendingCloseRef = useRef(false);
  const onSaveAndCloseRef = useRef(onSaveAndClose);
  onSaveAndCloseRef.current = onSaveAndClose;

  const explorerAnalysisId =
    "explorerAnalysisId" in block ? block.explorerAnalysisId : undefined;
  const comparisonExplorerAnalysisId =
    "comparisonExplorerAnalysisId" in block
      ? block.comparisonExplorerAnalysisId
      : undefined;
  const compareEnabled = draftExploreState.previousTimeFrame != null;
  const usesDashboardDateRange =
    block.globalControlSettings?.dateRange === true &&
    Boolean(dashboardGlobalControls?.dateRange);
  const getEffectiveDraftConfig = useCallback(
    () =>
      usesDashboardDateRange
        ? ({
            ...getEffectiveExplorationConfig(
              {
                ...block,
                config: stripExplorerDraftFields(draftExploreState),
              } as typeof block,
              { globalControls: dashboardGlobalControls },
            ),
            previousTimeFrame: draftExploreState.previousTimeFrame,
          } as typeof draftExploreState)
        : draftExploreState,
    [block, dashboardGlobalControls, draftExploreState, usesDashboardDateRange],
  );

  const nextComparison = useMemo<BlockComparison | undefined>(() => {
    const previousTimeFrame = draftExploreState.previousTimeFrame;
    if (!previousTimeFrame) return undefined;

    return {
      enabled: true,
      ...(draftExploreState.dateRange.predefined === "customDateRange"
        ? { previousTimeFrame }
        : {}),
    };
  }, [
    draftExploreState.dateRange.predefined,
    draftExploreState.previousTimeFrame,
  ]);
  useEffect(() => {
    const nextDraftConfig = stripExplorerDraftFields(draftExploreState);
    const nextConfig = usesDashboardDateRange
      ? restoreBlockLocalDateControls(nextDraftConfig, block.config)
      : nextDraftConfig;
    const shouldInvalidateResults =
      needsFetch && invalidateStaleResults && Boolean(explorerAnalysisId);
    if (
      (needsUpdate && !isEqual(block.config, nextConfig)) ||
      !isEqual(block.comparison, nextComparison) ||
      shouldInvalidateResults
    ) {
      setBlock({
        ...block,
        config: nextConfig,
        comparison: nextComparison,
        // Only invalidate the cached analysis when the change requires new data
        explorerAnalysisId:
          needsFetch && invalidateStaleResults ? "" : block.explorerAnalysisId,
        comparisonExplorerAnalysisId:
          nextComparison && (!needsFetch || !invalidateStaleResults)
            ? block.comparisonExplorerAnalysisId
            : undefined,
      } as
        | MetricExplorationBlockInterface
        | FactTableExplorationBlockInterface
        | DataSourceExplorationBlockInterface);
    }
  }, [
    needsFetch,
    needsUpdate,
    invalidateStaleResults,
    setBlock,
    block,
    draftExploreState,
    dashboardGlobalControls,
    nextComparison,
    usesDashboardDateRange,
    explorerAnalysisId,
  ]);

  // When Save & Close is requested and the block is stale, run the analysis first.
  useEffect(() => {
    if (!saveAndCloseTrigger) return;
    pendingCloseRef.current = true;
    handleSubmit({ force: true, config: getEffectiveDraftConfig() });
  }, [saveAndCloseTrigger, handleSubmit, getEffectiveDraftConfig]);

  // Once onRunComplete writes the required analysis ids, complete the save.
  useEffect(() => {
    if (
      pendingCloseRef.current &&
      explorerAnalysisId &&
      (!compareEnabled ||
        comparisonExplorerAnalysisId ||
        (!loading && !needsFetch))
    ) {
      pendingCloseRef.current = false;
      onSaveAndCloseRef.current?.();
    }
  }, [
    compareEnabled,
    comparisonExplorerAnalysisId,
    explorerAnalysisId,
    loading,
    needsFetch,
  ]);

  return (
    <ExplorerSideBar
      renderingInDashboardSidebar
      dashboardDateRange={dashboardGlobalControls?.dateRange}
      useDashboardDateControl={usesDashboardDateRange}
      onSubmit={() =>
        handleSubmit({ force: true, config: getEffectiveDraftConfig() })
      }
      onGlobalControlSettingsChange={(settings) => {
        const nextSettings = {
          ...block.globalControlSettings,
          ...settings,
        };
        if (settings.dateRange !== undefined) {
          setDraftExploreState((prev) => ({
            ...prev,
            dateRange:
              settings.dateRange && dashboardGlobalControls?.dateRange
                ? dashboardGlobalControls.dateRange
                : block.config.dateRange,
            dimensions: prev.dimensions.map((dimension) => {
              if (dimension.dimensionType !== "date") return dimension;
              if (
                settings.dateRange &&
                dashboardGlobalControls?.dateGranularity
              ) {
                return {
                  ...dimension,
                  dateGranularity: dashboardGlobalControls.dateGranularity,
                };
              }

              const blockDateDimension = block.config.dimensions.find(
                (blockDimension) => blockDimension.dimensionType === "date",
              );
              return blockDateDimension
                ? {
                    ...dimension,
                    dateGranularity: blockDateDimension.dateGranularity,
                  }
                : dimension;
            }),
          }));
        }
        setBlock({
          ...block,
          globalControlSettings: nextSettings,
        } as
          | MetricExplorationBlockInterface
          | FactTableExplorationBlockInterface
          | DataSourceExplorationBlockInterface);
      }}
    />
  );
}
