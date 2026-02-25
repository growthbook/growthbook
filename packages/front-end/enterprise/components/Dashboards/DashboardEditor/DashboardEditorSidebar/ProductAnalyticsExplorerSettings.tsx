import { useEffect, useRef, useState } from "react";
import {
  DashboardBlockInterfaceOrData,
  MetricExplorationBlockInterface,
  FactTableExplorationBlockInterface,
  DataSourceExplorationBlockInterface,
} from "shared/enterprise";
import {
  ProductAnalyticsConfig,
  ProductAnalyticsExploration,
} from "shared/validators";
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
  const { data, error, isLoading } = useApi<{
    status: number;
    exploration: ProductAnalyticsExploration;
  }>(`/product-analytics/exploration/${block.explorerAnalysisId}`, {
    shouldRun: () => !!block.explorerAnalysisId,
  });

  const initialBaselineRef = useRef(block.config ?? data?.exploration?.config);
  const [lastCommittedConfig, setLastCommittedConfig] = useState<
    ProductAnalyticsConfig | undefined
  >(() => initialBaselineRef.current);

  useEffect(() => {
    setLastCommittedConfig(initialBaselineRef.current ?? undefined);
  }, []);

  useEffect(() => {
    if (data?.exploration?.config) {
      setLastCommittedConfig(data.exploration.config);
    }
  }, [data?.exploration?.config]);

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
      initialConfig={block.config || data?.exploration.config}
      baselineConfigForStale={lastCommittedConfig ?? null}
      onRunComplete={(exploration) => {
        setBlock({
          ...block,
          explorerAnalysisId: exploration.id,
          config: exploration.config,
        });
        setLastCommittedConfig(exploration.config);
      }}
    >
      <ProductAnalyticsExplorerSideBarWrapper
        block={block}
        setBlock={setBlock}
      />
    </ExplorerProvider>
  );
}
