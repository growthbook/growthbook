import {
  DashboardBlockInterfaceOrData,
  MetricExplorationBlockInterface,
  FactTableExplorationBlockInterface,
  DataSourceExplorationBlockInterface,
} from "shared/enterprise";
import { ProductAnalyticsExploration } from "shared/validators";
import useApi from "@/hooks/useApi";
import LoadingSpinner from "@/components/LoadingSpinner";
import Callout from "@/ui/Callout";
import { ExplorerProvider } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
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
  saveAndCloseTrigger?: number;
  onSaveAndClose?: () => void;
}

export default function ProductAnalyticsExplorerSettings({
  block,
  setBlock,
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

  const initialConfig =
    data?.exploration?.config && block.config
      ? { ...data.exploration.config, ...block.config }
      : data?.exploration?.config || block.config;

  return (
    <ExplorerProvider
      initialConfig={initialConfig}
      hasExistingResults={!!block.explorerAnalysisId}
      trackingSource="dashboard-editor"
      onRunComplete={(exploration) => {
        setBlock({
          ...block,
          explorerAnalysisId: exploration.id,
          config: {
            ...exploration.config,
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
        saveAndCloseTrigger={saveAndCloseTrigger}
        onSaveAndClose={onSaveAndClose}
      />
    </ExplorerProvider>
  );
}
