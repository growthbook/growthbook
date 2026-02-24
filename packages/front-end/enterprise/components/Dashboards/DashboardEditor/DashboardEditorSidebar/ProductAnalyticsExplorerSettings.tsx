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
import { getInitialConfigByBlockType } from "@/enterprise/components/ProductAnalytics/util";
import { useDefinitions } from "@/services/DefinitionsContext";
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
}

export default function ProductAnalyticsExplorerSettings({
  block,
  setBlock,
}: Props) {
  const { data, error, isLoading } = useApi<{
    status: number;
    exploration: ProductAnalyticsExploration;
  }>(`/product-analytics/exploration/${block.explorerAnalysisId}`, {
    shouldRun: () => !!block.explorerAnalysisId,
  });
  const { datasources } = useDefinitions();

  const defaultDatasourceId = datasources[0]?.id;

  if (block.explorerAnalysisId && isLoading) {
    return <LoadingSpinner />;
  }

  if (block.explorerAnalysisId && error) {
    return (
      <Callout status="error">
        Failed to load explorer analysis: {error.message}
      </Callout>
    );
  }

  if (!defaultDatasourceId) {
    return (
      <Callout status="error">
        No datasource found. Please create a datasource first.
      </Callout>
    );
  }

  return (
    <ExplorerProvider
      initialConfig={
        block.config ||
        data?.exploration.config ||
        getInitialConfigByBlockType(block.type, defaultDatasourceId)
      }
      onRunComplete={(exploration) =>
        setBlock({
          ...block,
          explorerAnalysisId: exploration.id,
          config: exploration.config,
        })
      }
      onDraftDiverged={(draftConfig) =>
        setBlock({
          ...block,
          config: draftConfig,
          explorerAnalysisId: "",
        })
      }
    >
      <ProductAnalyticsExplorerSideBarWrapper />
    </ExplorerProvider>
  );
}
