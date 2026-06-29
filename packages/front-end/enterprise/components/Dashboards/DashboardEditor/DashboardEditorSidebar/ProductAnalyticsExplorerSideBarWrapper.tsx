import { useEffect, useMemo, useRef } from "react";
import {
  DashboardBlockInterfaceOrData,
  DashboardInterface,
  MetricExplorationBlockInterface,
  FactTableExplorationBlockInterface,
  DataSourceExplorationBlockInterface,
} from "shared/enterprise";
import type { BlockComparison } from "shared/enterprise";
import { isEqual } from "lodash";
import ExplorerSideBar from "@/enterprise/components/ProductAnalytics/SideBar/ExplorerSideBar";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import { stripExplorerDraftFields } from "@/enterprise/components/ProductAnalytics/util";

export default function ProductAnalyticsExplorerSideBarWrapper({
  block,
  setBlock,
  dashboardFilters,
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
  dashboardFilters?: DashboardInterface["filters"];
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
    const nextConfig =
      block.useDashboardFilters === true && dashboardFilters?.dateRange
        ? { ...nextDraftConfig, dateRange: block.config.dateRange }
        : nextDraftConfig;

    if (
      (needsUpdate && !isEqual(block.config, nextConfig)) ||
      !isEqual(block.comparison, nextComparison)
    ) {
      setBlock({
        ...block,
        config: nextConfig,
        comparison: nextComparison,
        // Only invalidate the cached analysis when the change requires new data
        explorerAnalysisId: needsFetch ? "" : block.explorerAnalysisId,
        comparisonExplorerAnalysisId:
          nextComparison && !needsFetch
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
    setBlock,
    block,
    draftExploreState,
    dashboardFilters,
    nextComparison,
  ]);

  // When Save & Close is requested and the block is stale, run the analysis first.
  useEffect(() => {
    if (!saveAndCloseTrigger) return;
    pendingCloseRef.current = true;
    handleSubmit({ force: true });
  }, [saveAndCloseTrigger, handleSubmit]);

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
      dashboardDateRange={dashboardFilters?.dateRange}
      useDashboardFilters={block.useDashboardFilters === true}
      onUseDashboardFiltersChange={(useDashboardFilters) => {
        setDraftExploreState((prev) => ({
          ...prev,
          dateRange:
            useDashboardFilters && dashboardFilters?.dateRange
              ? dashboardFilters.dateRange
              : block.config.dateRange,
        }));
        setBlock({
          ...block,
          useDashboardFilters,
        } as
          | MetricExplorationBlockInterface
          | FactTableExplorationBlockInterface
          | DataSourceExplorationBlockInterface);
      }}
    />
  );
}
