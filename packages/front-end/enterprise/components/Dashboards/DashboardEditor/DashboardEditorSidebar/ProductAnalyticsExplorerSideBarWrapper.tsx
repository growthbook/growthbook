import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  DashboardBlockInterfaceOrData,
  DashboardInterface,
  MetricExplorationBlockInterface,
  FactTableExplorationBlockInterface,
  DataSourceExplorationBlockInterface,
  evaluateDashboardGlobalControlsForBlock,
  getEffectiveExplorationConfig,
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
  const globalControlsEvaluation = useMemo(
    () =>
      dashboardGlobalControls
        ? evaluateDashboardGlobalControlsForBlock(block, {
            globalControls: dashboardGlobalControls,
          })
        : null,
    [block, dashboardGlobalControls],
  );
  const inheritedDashboardDimensions = useMemo(() => {
    return (globalControlsEvaluation?.dimensions ?? [])
      .filter((dimension) => dimension.target)
      .map((dimension) => ({
        id: dimension.dimension.id,
        label: dimension.dimension.label,
        column: dimension.column,
        maxValues: dimension.maxValues,
        enabled: dimension.enabled,
        applied: dimension.applied,
        skippedReason: dimension.skippedReason,
      }));
  }, [globalControlsEvaluation]);
  const usesDashboardDimensions = inheritedDashboardDimensions.some(
    (dimension) => dimension.applied,
  );
  const inheritedDashboardFilters = useMemo(() => {
    return (globalControlsEvaluation?.filters ?? []).map((filter) => ({
      id: filter.filter.id,
      label: filter.filter.label,
      column:
        filter.rowFilter?.column ??
        filter.target?.column ??
        filter.filter.column,
      operator: filter.filter.operator,
      values: filter.filter.values,
      enabled: filter.enabled,
      applied: filter.applied,
      skippedReason: filter.skippedReason,
    }));
  }, [globalControlsEvaluation]);
  const usesDashboardFilters = inheritedDashboardFilters.some(
    (filter) => filter.applied,
  );
  const getEffectiveDraftConfig = useCallback(
    () =>
      dashboardGlobalControls
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
    [block, dashboardGlobalControls, draftExploreState],
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
    const nextConfig =
      block.globalControlSettings?.dateRange === true ||
      usesDashboardDimensions ||
      usesDashboardFilters
        ? {
            ...nextDraftConfig,
            ...(block.globalControlSettings?.dateRange === true &&
            dashboardGlobalControls?.dateRange
              ? { dateRange: block.config.dateRange }
              : {}),
            ...(usesDashboardDimensions
              ? { dimensions: block.config.dimensions }
              : {}),
            ...(usesDashboardFilters ? { dataset: block.config.dataset } : {}),
          }
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
    dashboardGlobalControls,
    nextComparison,
    usesDashboardDimensions,
    usesDashboardFilters,
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
      inheritedDashboardDimensions={inheritedDashboardDimensions}
      inheritedDashboardFilters={inheritedDashboardFilters}
      useDashboardDateControl={block.globalControlSettings?.dateRange === true}
      onSubmit={() =>
        handleSubmit({ force: true, config: getEffectiveDraftConfig() })
      }
      onGlobalControlSettingsChange={(settings) => {
        const nextSettings = {
          ...block.globalControlSettings,
          ...settings,
          dimensions: {
            ...block.globalControlSettings?.dimensions,
            ...settings.dimensions,
          },
          filters: {
            ...block.globalControlSettings?.filters,
            ...settings.filters,
          },
        };
        if (settings.dateRange !== undefined) {
          setDraftExploreState((prev) => ({
            ...prev,
            dateRange:
              settings.dateRange && dashboardGlobalControls?.dateRange
                ? dashboardGlobalControls.dateRange
                : block.config.dateRange,
          }));
        }
        if (settings.dimensions !== undefined && dashboardGlobalControls) {
          const blockWithSettings = {
            ...block,
            globalControlSettings: nextSettings,
          } as typeof block;
          const effectiveConfig = getEffectiveExplorationConfig(
            blockWithSettings,
            { globalControls: dashboardGlobalControls },
          );
          setDraftExploreState((prev) => ({
            ...prev,
            dimensions: effectiveConfig.dimensions,
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
