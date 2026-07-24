import {
  DashboardBlockInterfaceOrData,
  DashboardInterface,
  MetricExplorationBlockInterface,
  FactTableExplorationBlockInterface,
  DataSourceExplorationBlockInterface,
  FunnelExplorationBlockInterface,
  buildComparisonDateRange,
  dashboardBlockHasIds,
  getEffectiveExplorationConfig,
  getExplorationDateControlFingerprint,
  restoreBlockLocalDateControls,
  blockUsesDashboardDateControl,
  SqlExplorationBlockInterface,
} from "shared/enterprise";
import { ReactNode } from "react";
import { isEqual } from "lodash";
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
  saveAndCloseTrigger?: number;
  onSaveAndClose?: () => void;
  hideDataSourceSelector?: boolean;
  sqlChartConfigOnly?: boolean;
  dashboardHeaderLeadingContent?: ReactNode;
}

export default function ProductAnalyticsExplorerSettings({
  block,
  setBlock,
  dashboardGlobalControls,
  saveAndCloseTrigger,
  onSaveAndClose,
  hideDataSourceSelector,
  sqlChartConfigOnly,
  dashboardHeaderLeadingContent,
}: Props) {
  const { data, error } = useApi<{
    status: number;
    exploration: ProductAnalyticsExploration;
  }>(`/product-analytics/exploration/${block.explorerAnalysisId}`, {
    shouldRun: () => !!block.explorerAnalysisId,
  });

  // Ignore retained SWR data from the previous analysis while the request key
  // changes so stale submitted settings cannot invalidate the new analysis.
  const exploration =
    data?.exploration.id === block.explorerAnalysisId
      ? data.exploration
      : undefined;
  const baseInitialConfig =
    exploration?.config && block.config
      ? { ...exploration.config, ...block.config }
      : (exploration?.config ?? block.config ?? null);
  const blockForInitialConfig = baseInitialConfig
    ? ({
        ...block,
        config: baseInitialConfig,
      } as typeof block)
    : null;
  const dateControlledBlock = blockUsesDashboardDateControl(block)
    ? block
    : null;
  const effectiveInitialConfig = blockForInitialConfig
    ? dashboardGlobalControls &&
      blockUsesDashboardDateControl(blockForInitialConfig)
      ? getEffectiveExplorationConfig(blockForInitialConfig, {
          globalControls: dashboardGlobalControls,
        })
      : baseInitialConfig
    : null;
  const usesDashboardDateRange =
    dateControlledBlock?.globalControlSettings?.dateRange === true &&
    Boolean(dashboardGlobalControls?.dateRange);
  const hasStaleDashboardDateResults =
    usesDashboardDateRange &&
    effectiveInitialConfig !== null &&
    exploration !== undefined
      ? !isEqual(
          getExplorationDateControlFingerprint(effectiveInitialConfig),
          getExplorationDateControlFingerprint(exploration.config),
        )
      : false;
  if (!block.config || !effectiveInitialConfig) {
    return <LoadingSpinner />;
  }

  if (block.explorerAnalysisId && error) {
    return (
      <Callout status="error">
        Failed to load explorer analysis: {error.message}
      </Callout>
    );
  }

  const initialConfig: ExplorerDraftConfig = block.comparison?.enabled
    ? {
        ...effectiveInitialConfig,
        previousTimeFrame:
          block.comparison.previousTimeFrame ??
          buildComparisonDateRange(effectiveInitialConfig.dateRange),
      }
    : effectiveInitialConfig;
  const initialSubmittedConfig: ExplorerDraftConfig | undefined = exploration
    ? block.comparison?.enabled
      ? {
          ...exploration.config,
          previousTimeFrame:
            block.comparison.previousTimeFrame ??
            buildComparisonDateRange(exploration.config.dateRange),
        }
      : exploration.config
    : undefined;
  const explorerProviderKey = [
    dashboardBlockHasIds(block) ? block.id : "",
    block.globalControlSettings?.dateRange === true,
    JSON.stringify(dashboardGlobalControls ?? null),
    hasStaleDashboardDateResults,
  ].join(":");

  return (
    <ExplorerProvider
      key={explorerProviderKey}
      initialConfig={initialConfig}
      initialSubmittedConfig={initialSubmittedConfig}
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
          usesDashboardDateRange && dateControlledBlock
            ? restoreBlockLocalDateControls(
                exploration.config as typeof dateControlledBlock.config,
                dateControlledBlock.config,
              )
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
          | DataSourceExplorationBlockInterface
          | SqlExplorationBlockInterface
          | FunnelExplorationBlockInterface);
      }}
    >
      <ProductAnalyticsExplorerSideBarWrapper
        block={block}
        setBlock={setBlock}
        dashboardGlobalControls={dashboardGlobalControls}
        invalidateStaleResults={!hasStaleDashboardDateResults}
        saveAndCloseTrigger={saveAndCloseTrigger}
        onSaveAndClose={onSaveAndClose}
        hideDataSourceSelector={hideDataSourceSelector}
        sqlChartConfigOnly={sqlChartConfigOnly}
        dashboardHeaderLeadingContent={dashboardHeaderLeadingContent}
      />
    </ExplorerProvider>
  );
}
