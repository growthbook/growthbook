import { ReactNode, useCallback, useEffect, useMemo, useRef } from "react";
import {
  DashboardBlockInterfaceOrData,
  DashboardInterface,
  MetricExplorationBlockInterface,
  FactTableExplorationBlockInterface,
  DataSourceExplorationBlockInterface,
  SqlExplorationBlockInterface,
  blockUsesDashboardDateControl,
  FunnelExplorationBlockInterface,
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
  onPreSaveRunSettled,
  hideDataSourceSelector = false,
  sqlExploreConfigOnly = false,
  dashboardHeaderLeadingContent,
}: {
  block: DashboardBlockInterfaceOrData<
    | MetricExplorationBlockInterface
    | FactTableExplorationBlockInterface
    | DataSourceExplorationBlockInterface
    | SqlExplorationBlockInterface
    | FunnelExplorationBlockInterface
  >;
  setBlock: React.Dispatch<
    DashboardBlockInterfaceOrData<
      | MetricExplorationBlockInterface
      | FactTableExplorationBlockInterface
      | DataSourceExplorationBlockInterface
      | SqlExplorationBlockInterface
      | FunnelExplorationBlockInterface
    >
  >;
  dashboardGlobalControls?: DashboardInterface["globalControls"];
  invalidateStaleResults?: boolean;
  saveAndCloseTrigger?: number;
  onSaveAndClose?: () => void;
  /** Fires when the pre-save run reaches any terminal state, so the caller can
   *  stop showing Save & Close as busy whether or not the save follows. */
  onPreSaveRunSettled?: () => void;
  hideDataSourceSelector?: boolean;
  sqlExploreConfigOnly?: boolean;
  dashboardHeaderLeadingContent?: ReactNode;
}) {
  const {
    needsFetch,
    needsUpdate,
    draftExploreState,
    setDraftExploreState,
    handleSubmit,
    loading,
    error,
    isSubmittable,
    managedWarehouseUnavailable,
    comparisonMode,
    linkedFunnelMetricId,
  } = useExplorerContext();
  const pendingCloseRef = useRef(false);
  const onSaveAndCloseRef = useRef(onSaveAndClose);
  onSaveAndCloseRef.current = onSaveAndClose;
  const onPreSaveRunSettledRef = useRef(onPreSaveRunSettled);
  onPreSaveRunSettledRef.current = onPreSaveRunSettled;
  // Read through refs so a new trigger value is the only thing that starts a
  // run — both change identity on every draft edit.
  const handleSubmitRef = useRef(handleSubmit);
  handleSubmitRef.current = handleSubmit;

  const explorerAnalysisId =
    "explorerAnalysisId" in block ? block.explorerAnalysisId : undefined;
  const comparisonExplorerAnalysisId =
    "comparisonExplorerAnalysisId" in block
      ? block.comparisonExplorerAnalysisId
      : undefined;
  const compareEnabled = draftExploreState.previousTimeFrame != null;
  const dateControlledBlock = blockUsesDashboardDateControl(block)
    ? block
    : null;
  const usesDashboardDateRange =
    dateControlledBlock !== null && Boolean(dashboardGlobalControls?.dateRange);
  const getEffectiveDraftConfig = useCallback(
    () =>
      usesDashboardDateRange && dateControlledBlock
        ? ({
            ...getEffectiveExplorationConfig(
              {
                ...dateControlledBlock,
                config: stripExplorerDraftFields(
                  draftExploreState,
                ) as typeof dateControlledBlock.config,
              } as typeof dateControlledBlock,
              { globalControls: dashboardGlobalControls },
            ),
            previousTimeFrame: draftExploreState.previousTimeFrame,
          } as typeof draftExploreState)
        : draftExploreState,
    [
      dashboardGlobalControls,
      dateControlledBlock,
      draftExploreState,
      usesDashboardDateRange,
    ],
  );
  const getEffectiveDraftConfigRef = useRef(getEffectiveDraftConfig);
  getEffectiveDraftConfigRef.current = getEffectiveDraftConfig;

  const nextComparison = useMemo<BlockComparison | undefined>(() => {
    const previousTimeFrame = draftExploreState.previousTimeFrame;
    if (!previousTimeFrame) return undefined;

    return {
      enabled: true,
      mode: comparisonMode,
      // Only a hand-picked window needs persisting; the derived modes roll.
      ...(comparisonMode === "custom" ? { previousTimeFrame } : {}),
    };
  }, [comparisonMode, draftExploreState.previousTimeFrame]);
  const blockLinkedMetricId =
    "linkedFunnelMetricId" in block
      ? (block.linkedFunnelMetricId ?? null)
      : null;
  const linkedMetricChanged = linkedFunnelMetricId !== blockLinkedMetricId;

  useEffect(() => {
    const nextDraftConfig = stripExplorerDraftFields(draftExploreState);
    const nextConfig =
      usesDashboardDateRange && dateControlledBlock
        ? restoreBlockLocalDateControls(
            nextDraftConfig as typeof dateControlledBlock.config,
            dateControlledBlock.config,
          )
        : nextDraftConfig;
    const shouldInvalidateResults =
      needsFetch && invalidateStaleResults && Boolean(explorerAnalysisId);
    const comparisonChanged =
      needsUpdate && !isEqual(block.comparison, nextComparison);
    if (
      (needsUpdate && !isEqual(block.config, nextConfig)) ||
      comparisonChanged ||
      shouldInvalidateResults ||
      linkedMetricChanged
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
        ...(block.type === "funnel-exploration"
          ? { linkedFunnelMetricId }
          : {}),
      } as
        | MetricExplorationBlockInterface
        | FactTableExplorationBlockInterface
        | DataSourceExplorationBlockInterface
        | SqlExplorationBlockInterface
        | FunnelExplorationBlockInterface);
    }
  }, [
    needsFetch,
    needsUpdate,
    invalidateStaleResults,
    setBlock,
    block,
    draftExploreState,
    dashboardGlobalControls,
    dateControlledBlock,
    nextComparison,
    usesDashboardDateRange,
    explorerAnalysisId,
    linkedMetricChanged,
    linkedFunnelMetricId,
  ]);

  // When Save & Close is requested and the block is stale, run the analysis first.
  // Keyed on the trigger value alone: the previous dependency list re-fired this
  // forced run on every draft edit once the trigger had been bumped.
  useEffect(() => {
    if (!saveAndCloseTrigger) return;
    pendingCloseRef.current = true;
    void handleSubmitRef.current({
      force: true,
      config: getEffectiveDraftConfigRef.current(),
    });
  }, [saveAndCloseTrigger]);

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
      onPreSaveRunSettledRef.current?.();
      onSaveAndCloseRef.current?.();
    }
  }, [
    compareEnabled,
    comparisonExplorerAnalysisId,
    explorerAnalysisId,
    loading,
    needsFetch,
  ]);

  // A run that errors, or that doSubmit declines to start at all, never reaches
  // onRunComplete — release the pending close so Save & Close stops spinning
  // instead of waiting on an analysis id that is never coming.
  useEffect(() => {
    if (!pendingCloseRef.current || loading) return;
    if (error || managedWarehouseUnavailable || !isSubmittable) {
      pendingCloseRef.current = false;
      onPreSaveRunSettledRef.current?.();
    }
  }, [error, loading, managedWarehouseUnavailable, isSubmittable]);

  return (
    <>
      <ExplorerSideBar
        renderingInDashboardSidebar
        hideDataSourceSelector={hideDataSourceSelector}
        sqlExploreConfigOnly={sqlExploreConfigOnly}
        dashboardHeaderLeadingContent={dashboardHeaderLeadingContent}
        dashboardDateRange={dashboardGlobalControls?.dateRange}
        useDashboardDateControl={usesDashboardDateRange}
        onSubmit={() =>
          handleSubmit({ force: true, config: getEffectiveDraftConfig() })
        }
        // Writes config, not just the flag: block.config is what reseeds the draft,
        // so this is what makes the edit survive a provider remount.
        onClaimDashboardDateRange={({ dateRange, granularity }) =>
          setBlock({
            ...block,
            globalControlSettings: {
              ...block.globalControlSettings,
              dateRange: false,
            },
            config: {
              ...block.config,
              dateRange,
              dimensions: granularity
                ? block.config.dimensions.map((dimension) =>
                    dimension.dimensionType === "date"
                      ? { ...dimension, dateGranularity: granularity }
                      : dimension,
                  )
                : block.config.dimensions,
            },
          } as
            | MetricExplorationBlockInterface
            | FactTableExplorationBlockInterface
            | DataSourceExplorationBlockInterface
            | FunnelExplorationBlockInterface)
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
            | DataSourceExplorationBlockInterface
            | SqlExplorationBlockInterface);
        }}
      />
    </>
  );
}
