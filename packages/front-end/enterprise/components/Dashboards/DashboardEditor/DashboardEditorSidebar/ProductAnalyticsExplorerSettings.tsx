import {
  DashboardBlockInterfaceOrData,
  DashboardInterface,
  MetricExplorationBlockInterface,
  FactTableExplorationBlockInterface,
  DataSourceExplorationBlockInterface,
  buildComparisonDateRange,
  dashboardBlockHasIds,
  evaluateDashboardGlobalControlsForBlock,
  getEffectiveExplorationConfig,
} from "shared/enterprise";
import type {
  ExplorationDateRange,
  ProductAnalyticsExploration,
} from "shared/validators";
import useApi from "@/hooks/useApi";
import LoadingSpinner from "@/components/LoadingSpinner";
import Callout from "@/ui/Callout";
import { ExplorerProvider } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import type { ExplorerDraftConfig } from "@/enterprise/components/ProductAnalytics/util";
import ProductAnalyticsExplorerSideBarWrapper from "./ProductAnalyticsExplorerSideBarWrapper";

interface Props {
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
}

export default function ProductAnalyticsExplorerSettings({
  block,
  setBlock,
  dashboardGlobalControls,
  saveAndCloseTrigger,
  onSaveAndClose,
}: Props) {
  const { data, error } = useApi<{
    status: number;
    exploration: ProductAnalyticsExploration;
  }>(`/product-analytics/exploration/${block.explorerAnalysisId}`, {
    shouldRun: () => !!block.explorerAnalysisId,
  });

  if (!block.config) {
    return <LoadingSpinner />;
  }

  if (block.explorerAnalysisId && error) {
    return (
      <Callout status="error">
        Failed to load explorer analysis: {error.message}
      </Callout>
    );
  }

  const baseInitialConfig =
    data?.exploration?.config && block.config
      ? { ...data.exploration.config, ...block.config }
      : data?.exploration?.config || block.config;
  const blockForInitialConfig = {
    ...block,
    config: baseInitialConfig,
  } as typeof block;
  const effectiveInitialConfig = dashboardGlobalControls
    ? getEffectiveExplorationConfig(blockForInitialConfig, {
        globalControls: {
          ...dashboardGlobalControls,
          filters: undefined,
        },
      })
    : baseInitialConfig;
  const usesDashboardDimensions = dashboardGlobalControls
    ? evaluateDashboardGlobalControlsForBlock(block, {
        globalControls: dashboardGlobalControls,
      }).dimensions.some((dimension) => dimension.applied)
    : false;
  const usesDashboardFilters = dashboardGlobalControls
    ? evaluateDashboardGlobalControlsForBlock(block, {
        globalControls: dashboardGlobalControls,
      }).filters.some((filter) => filter.applied)
    : false;
  const initialConfig: ExplorerDraftConfig = block.comparison?.enabled
    ? {
        ...effectiveInitialConfig,
        previousTimeFrame:
          block.comparison.previousTimeFrame ??
          buildComparisonDateRange(effectiveInitialConfig.dateRange),
      }
    : effectiveInitialConfig;
  const explorerProviderKey = [
    dashboardBlockHasIds(block) ? block.id : "",
    block.explorerAnalysisId,
    block.globalControlSettings?.dateRange === true,
    JSON.stringify(dashboardGlobalControls ?? null),
  ].join(":");

  return (
    <ExplorerProvider
      key={explorerProviderKey}
      initialConfig={initialConfig}
      hasExistingResults={!!block.explorerAnalysisId}
      trackingSource="dashboard-editor"
      onRunComplete={(
        exploration,
        comparisonExploration,
        previousTimeFrame: ExplorationDateRange | null,
      ) => {
        const comparison =
          previousTimeFrame != null
            ? {
                enabled: true,
                ...(exploration.config.dateRange.predefined ===
                  "customDateRange" && { previousTimeFrame }),
              }
            : undefined;
        const nextConfig =
          block.globalControlSettings?.dateRange === true ||
          usesDashboardDimensions ||
          usesDashboardFilters
            ? {
                ...exploration.config,
                ...(block.globalControlSettings?.dateRange === true
                  ? { dateRange: block.config.dateRange }
                  : {}),
                ...(usesDashboardDimensions
                  ? { dimensions: block.config.dimensions }
                  : {}),
                ...(usesDashboardFilters
                  ? { dataset: block.config.dataset }
                  : {}),
              }
            : exploration.config;
        setBlock({
          ...block,
          explorerAnalysisId: exploration.id,
          ...(comparison
            ? {
                comparison,
                comparisonExplorerAnalysisId: comparisonExploration?.id,
              }
            : {
                comparison: undefined,
                comparisonExplorerAnalysisId: undefined,
              }),
          config: {
            ...nextConfig,
            chartType: block.config?.chartType || exploration.config?.chartType,
          },
        } as
          | MetricExplorationBlockInterface
          | FactTableExplorationBlockInterface
          | DataSourceExplorationBlockInterface);
      }}
    >
      <ProductAnalyticsExplorerSideBarWrapper
        block={block}
        setBlock={setBlock}
        dashboardGlobalControls={dashboardGlobalControls}
        saveAndCloseTrigger={saveAndCloseTrigger}
        onSaveAndClose={onSaveAndClose}
      />
    </ExplorerProvider>
  );
}
