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
}: BlockProps<
  | MetricExplorationBlockInterface
  | FactTableExplorationBlockInterface
  | DataSourceExplorationBlockInterface
>) {
  const { data, error, isLoading } = useApi<{
    status: number;
    exploration: ProductAnalyticsExploration;
    query: QueryInterface | null;
  }>(`/product-analytics/exploration/${block.explorerAnalysisId}`, {
    shouldRun: () => !!block.explorerAnalysisId,
  });

  if (isLoading) {
    return <LoadingSpinner />;
  }

  if (!data?.exploration) {
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
    <Flex direction="column" style={{ height: 500 }} gap="2">
      {shouldShowTable ? (
        <ExplorerDataTable
          exploration={data.exploration}
          error={data.exploration.error ?? error?.message ?? null}
          submittedExploreState={block.config ?? data.exploration.config}
          loading={isLoading}
          hasChart={false}
          query={data?.query ?? null}
        />
      ) : (
        <ExplorerChart
          exploration={data?.exploration}
          error={data?.exploration.error || error?.message || null}
          loading={isLoading}
          submittedExploreState={block.config ?? data?.exploration.config}
        />
      )}
    </Flex>
  );
}
