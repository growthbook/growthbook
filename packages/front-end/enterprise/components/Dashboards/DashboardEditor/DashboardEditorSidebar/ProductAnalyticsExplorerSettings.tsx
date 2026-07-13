import {
  DashboardBlockInterfaceOrData,
  DashboardInterface,
  MetricExplorationBlockInterface,
  FactTableExplorationBlockInterface,
  DataSourceExplorationBlockInterface,
  buildComparisonDateRange,
  dashboardBlockHasIds,
  getEffectiveExplorationConfig,
  getExplorationDateControlFingerprint,
  restoreBlockLocalDateControls,
} from "shared/enterprise";
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

  const baseInitialConfig =
    data?.exploration?.config && block.config
      ? { ...data.exploration.config, ...block.config }
      : (data?.exploration?.config ?? block.config ?? null);
  const blockForInitialConfig = baseInitialConfig
    ? ({
        ...block,
        config: baseInitialConfig,
      } as typeof block)
    : null;
  const effectiveInitialConfig = blockForInitialConfig
    ? dashboardGlobalControls
      ? getEffectiveExplorationConfig(blockForInitialConfig, {
          globalControls: dashboardGlobalControls,
        })
      : baseInitialConfig
    : null;
  const usesDashboardDateRange =
    block.globalControlSettings?.dateRange === true &&
    Boolean(dashboardGlobalControls?.dateRange);
  const hasStaleDashboardDateResults =
    usesDashboardDateRange &&
    effectiveInitialConfig !== null &&
    data?.exploration !== undefined
      ? !isEqual(
          getExplorationDateControlFingerprint(effectiveInitialConfig),
          getExplorationDateControlFingerprint(data.exploration.config),
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
  const initialSubmittedConfig: ExplorerDraftConfig | undefined =
    data?.exploration
      ? block.comparison?.enabled
        ? {
            ...data.exploration.config,
            previousTimeFrame:
              block.comparison.previousTimeFrame ??
              buildComparisonDateRange(data.exploration.config.dateRange),
          }
        : data.exploration.config
      : undefined;
  const explorerProviderKey = [
    dashboardBlockHasIds(block) ? block.id : "",
    block.explorerAnalysisId,
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
        const nextConfig = usesDashboardDateRange
          ? restoreBlockLocalDateControls(exploration.config, block.config)
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
        invalidateStaleResults={!hasStaleDashboardDateResults}
        saveAndCloseTrigger={saveAndCloseTrigger}
        onSaveAndClose={onSaveAndClose}
      />
    </ExplorerProvider>
  );
}
