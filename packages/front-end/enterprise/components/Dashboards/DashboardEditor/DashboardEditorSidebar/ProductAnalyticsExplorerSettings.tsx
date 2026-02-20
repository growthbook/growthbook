import {
  DashboardBlockInterfaceOrData,
  MetricExplorationBlockInterface,
  FactTableExplorationBlockInterface,
  DataSourceExplorationBlockInterface,
} from "shared/enterprise";
import { ExplorerAnalysisResponse } from "shared/validators";
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
}

export default function ProductAnalyticsExplorerSettings({
  block,
  setBlock,
}: Props) {
  const { data, error, isLoading } = useApi<ExplorerAnalysisResponse>(
    `/product-analytics/explorer-analysis/${block.explorerAnalysisId}`,
    { shouldRun: () => !!block.explorerAnalysisId },
  );

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

  return (
    <ExplorerProvider
      initialConfig={data?.config}
      key={block.explorerAnalysisId ?? "new"}
    >
      <ProductAnalyticsExplorerSideBarWrapper
        block={block}
        setBlock={setBlock}
      />
    </ExplorerProvider>
  );
}
