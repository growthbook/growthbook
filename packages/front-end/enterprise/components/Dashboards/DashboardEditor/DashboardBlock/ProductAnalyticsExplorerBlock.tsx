import { Box, Flex } from "@radix-ui/themes";
import {
  MetricExplorationBlockInterface,
  FactTableExplorationBlockInterface,
  DataSourceExplorationBlockInterface,
} from "shared/enterprise";
import { ProductAnalyticsExploration } from "shared/validators";
import useApi from "@/hooks/useApi";
import ExplorerChart from "@/enterprise/components/ProductAnalytics/MainSection/ExplorerChart";
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

  return (
    <Flex direction="column" style={{ height: 500 }} gap="2">
      <ExplorerChart
        exploration={data?.exploration}
        error={data?.exploration.error || error?.message || null}
        loading={isLoading}
        submittedExploreState={data?.exploration.config}
      />
    </Flex>
  );
}
