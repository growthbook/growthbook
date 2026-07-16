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
  resolveBlockComparison,
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
    exploration !== undefined
      ? !isEqual(
          getExplorationDateControlFingerprint(effectiveInitialConfig),
          getExplorationDateControlFingerprint(exploration.config),
        )
      : false;
  const effectiveComparison = resolveBlockComparison(block);
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

  const initialConfig: ExplorerDraftConfig = effectiveComparison?.enabled
    ? {
        ...effectiveInitialConfig,
        previousTimeFrame:
          effectiveComparison.previousTimeFrame ??
          buildComparisonDateRange(effectiveInitialConfig.dateRange),
      }
    : effectiveInitialConfig;
  const initialSubmittedConfig: ExplorerDraftConfig | undefined = exploration
    ? effectiveComparison?.enabled
      ? {
          ...exploration.config,
          previousTimeFrame:
            effectiveComparison.previousTimeFrame ??
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
        const nextConfig = usesDashboardDateRange
          ? restoreBlockLocalDateControls(exploration.config, block.config)
          : exploration.config;
        setBlock({
          ...block,
          explorerAnalysisId: exploration.id,
          comparison,
          comparisonExplorerAnalysisId: comparisonExploration?.id,
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
