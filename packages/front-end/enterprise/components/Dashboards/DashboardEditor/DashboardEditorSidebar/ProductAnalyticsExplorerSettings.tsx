import {
  DashboardBlockInterfaceOrData,
  DashboardInterface,
  MetricExplorationBlockInterface,
  FactTableExplorationBlockInterface,
  DataSourceExplorationBlockInterface,
  FunnelExplorationBlockInterface,
  dashboardBlockHasIds,
  getEffectiveExplorationConfig,
  getExplorationDateControlFingerprint,
  resolveComparisonMode,
  resolveComparisonPreviousTimeFrame,
  restoreBlockLocalDateControls,
  blockUsesDashboardDateControl,
  SqlExplorationBlockInterface,
} from "shared/enterprise";
import { ReactNode } from "react";
import { isEqual } from "lodash";
import type {
  ComparisonMode,
  ExplorationDateRange,
  ProductAnalyticsExploration,
} from "shared/validators";
import useApi from "@/hooks/useApi";
import LoadingSpinner from "@/components/LoadingSpinner";
import Callout from "@/ui/Callout";
import { ExplorerProvider } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import {
  normalizeTimelessSqlConfig,
  stripExplorerDraftFields,
  type ExplorerDraftConfig,
} from "@/enterprise/components/ProductAnalytics/util";
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
  sqlExploreConfigOnly?: boolean;
  dashboardHeaderLeadingContent?: ReactNode;
}

export default function ProductAnalyticsExplorerSettings({
  block,
  setBlock,
  dashboardGlobalControls,
  saveAndCloseTrigger,
  onSaveAndClose,
  hideDataSourceSelector,
  sqlExploreConfigOnly,
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

  const blockComparisonMode = block.comparison
    ? resolveComparisonMode(block.comparison)
    : null;
  const initialConfig: ExplorerDraftConfig =
    block.comparison?.enabled && blockComparisonMode
      ? {
          ...effectiveInitialConfig,
          comparisonMode: blockComparisonMode,
          previousTimeFrame: resolveComparisonPreviousTimeFrame(
            effectiveInitialConfig.dateRange,
            block.comparison,
          ),
        }
      : effectiveInitialConfig;
  const initialSubmittedConfig: ExplorerDraftConfig | undefined = exploration
    ? block.comparison?.enabled && blockComparisonMode
      ? {
          ...exploration.config,
          comparisonMode: blockComparisonMode,
          previousTimeFrame: resolveComparisonPreviousTimeFrame(
            exploration.config.dateRange,
            block.comparison,
          ),
        }
      : exploration.config
    : undefined;
  // Deliberately excluded, since both remount the provider and lose in-flight work:
  // - `block.comparison`, which the provider owns while open
  // - the date-range follow flag, which now flips on every edit of an inherited
  //   range. Revert reseeds the draft itself, so it needs no remount.
  const explorerProviderKey = [
    dashboardBlockHasIds(block) ? block.id : "",
    JSON.stringify(dashboardGlobalControls ?? null),
    hasStaleDashboardDateResults,
  ].join(":");

  return (
    <ExplorerProvider
      key={explorerProviderKey}
      initialConfig={initialConfig}
      initialSubmittedConfig={initialSubmittedConfig}
      hasExistingResults={!!block.explorerAnalysisId}
      initialLinkedFunnelMetricId={
        "linkedFunnelMetricId" in block
          ? (block.linkedFunnelMetricId ?? null)
          : null
      }
      trackingSource="dashboard-editor"
      onRunComplete={(
        exploration,
        comparisonExploration,
        previousTimeFrame: ExplorationDateRange | null,
        comparisonMode: ComparisonMode | null,
      ) => {
        const comparison =
          previousTimeFrame != null && comparisonMode != null
            ? {
                enabled: true,
                mode: comparisonMode,
                ...(comparisonMode === "custom" && { previousTimeFrame }),
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
          config: stripExplorerDraftFields(
            normalizeTimelessSqlConfig({
              ...nextConfig,
              chartType:
                block.config?.chartType || exploration.config?.chartType,
            }),
          ),
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
        sqlExploreConfigOnly={sqlExploreConfigOnly}
        dashboardHeaderLeadingContent={dashboardHeaderLeadingContent}
      />
    </ExplorerProvider>
  );
}
