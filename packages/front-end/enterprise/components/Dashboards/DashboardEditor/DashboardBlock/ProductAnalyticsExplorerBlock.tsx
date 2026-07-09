import { Box, Flex } from "@radix-ui/themes";
import {
  MetricExplorationBlockInterface,
  FactTableExplorationBlockInterface,
  DataSourceExplorationBlockInterface,
} from "shared/enterprise";
import { ProductAnalyticsExploration } from "shared/validators";
import { QueryInterface } from "shared/types/query";
import useApi from "@/hooks/useApi";
import ExplorerChart from "@/enterprise/components/ProductAnalytics/MainSection/ExplorerChart";
import ExplorerDataTable from "@/enterprise/components/ProductAnalytics/MainSection/ExplorerDataTable";
import LoadingSpinner from "@/components/LoadingSpinner";
import Callout from "@/ui/Callout";
import { BlockProps } from ".";

export default function ProductAnalyticsExplorerBlock({
  block,
  hideSql,
  exploration: explorationProp,
  query: queryProp,
}: BlockProps<
  | MetricExplorationBlockInterface
  | FactTableExplorationBlockInterface
  | DataSourceExplorationBlockInterface
> & {
  // When supplied directly (public dashboard page), render from these and skip
  // the authenticated fetch, which would 401 for an anonymous viewer.
  exploration?: ProductAnalyticsExploration;
  query?: QueryInterface | null;
}) {
  const { data, error, isLoading } = useApi<{
    status: number;
    exploration: ProductAnalyticsExploration;
    query: QueryInterface | null;
  }>(`/product-analytics/exploration/${block.explorerAnalysisId}`, {
    shouldRun: () => !explorationProp && !!block.explorerAnalysisId,
  });

  const exploration = explorationProp ?? data?.exploration;
  const query = queryProp !== undefined ? queryProp : (data?.query ?? null);
  const loading = explorationProp ? false : isLoading;
  const errorMessage = error?.message ?? null;

  if (loading) {
    return <LoadingSpinner />;
  }

  if (!exploration) {
    return (
      <Box p="4" style={{ textAlign: "center" }}>
        <Callout status="info">
          Please click the <code>Update</code> button to generate the necessary
          data.
        </Callout>
      </Box>
    );
  }

  const shouldShowTable = ["table", "timeseries-table"].includes(
    block.config?.chartType ?? "",
  );

  return (
    <Flex direction="column" gap="2" style={{ height: "100%" }}>
      {shouldShowTable ? (
        <ExplorerDataTable
          exploration={exploration}
          error={exploration.error ?? errorMessage}
          submittedExploreState={block.config ?? exploration.config}
          loading={loading}
          hasChart={false}
          query={query}
          hideSql={hideSql}
        />
      ) : (
        <ExplorerChart
          exploration={exploration}
          error={exploration.error || errorMessage}
          loading={loading}
          submittedExploreState={block.config ?? exploration.config}
        />
      )}
    </Flex>
  );
}
