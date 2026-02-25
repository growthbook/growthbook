import { Box, Flex } from "@radix-ui/themes";
import {
  MetricExplorationBlockInterface,
  FactTableExplorationBlockInterface,
  DataSourceExplorationBlockInterface,
} from "shared/enterprise";
import { ProductAnalyticsExploration } from "shared/validators";
import useApi from "@/hooks/useApi";
import Text from "@/ui/Text";
import ExplorerChart from "@/enterprise/components/ProductAnalytics/MainSection/ExplorerChart";
import LoadingSpinner from "@/components/LoadingSpinner";
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

  if (!block.config) {
    return (
      <Box p="4" style={{ textAlign: "center" }}>
        <Text>Configure this block to display explorer data.</Text>
      </Box>
    );
  }
  if (!data?.exploration) {
    return (
      <Box p="4" style={{ textAlign: "center" }}>
        <Text>
          Please click the `Update` button to generate the necessary data.
        </Text>
      </Box>
    );
  }

  return (
    <Flex direction="column" style={{ height: 500 }}>
      <ExplorerChart
        exploration={data?.exploration}
        error={data?.exploration.error || error?.message || null}
        loading={isLoading}
        submittedExploreState={data?.exploration.config}
      />
    </Flex>
  );
}
