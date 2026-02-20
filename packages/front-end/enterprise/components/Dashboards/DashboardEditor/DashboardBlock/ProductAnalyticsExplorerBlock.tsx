import { Box } from "@radix-ui/themes";
import {
  MetricExplorationBlockInterface,
  FactTableExplorationBlockInterface,
  DataSourceExplorationBlockInterface,
} from "shared/enterprise";
import {
  ExplorerAnalysisResponse,
  ProductAnalyticsConfig,
} from "shared/validators";
import useApi from "@/hooks/useApi";
import Text from "@/ui/Text";
import ExplorerChart from "@/enterprise/components/ProductAnalytics/MainSection/ExplorerChart";
import { BlockProps } from ".";

const PLACEHOLDER_CONFIG: ProductAnalyticsConfig = {
  analysisId: undefined,
  dataset: { type: "metric", values: [] },
  dimensions: [
    { dimensionType: "date", column: "date", dateGranularity: "auto" },
  ],
  chartType: "line",
  dateRange: {
    predefined: "last30Days",
    lookbackValue: 30,
    lookbackUnit: "day",
    startDate: null,
    endDate: null,
  },
  lastRefreshedAt: null,
};

export default function ProductAnalyticsExplorerBlock({
  block,
}: BlockProps<
  | MetricExplorationBlockInterface
  | FactTableExplorationBlockInterface
  | DataSourceExplorationBlockInterface
>) {
  const { data, error, isLoading } = useApi<ExplorerAnalysisResponse>(
    `/product-analytics/explorer-analysis/${block.explorerAnalysisId}`,
    { shouldRun: () => !!block.explorerAnalysisId },
  );

  if (!block.explorerAnalysisId) {
    return (
      <Box p="4" style={{ textAlign: "center" }}>
        <Text>Configure this block to display explorer data.</Text>
      </Box>
    );
  }

  if (isLoading) {
    return (
      <ExplorerChart
        exploreData={null}
        submittedExploreState={PLACEHOLDER_CONFIG}
        loading={true}
        exploreError={null}
      />
    );
  }

  if (error) {
    return (
      <ExplorerChart
        exploreData={null}
        submittedExploreState={data?.config ?? PLACEHOLDER_CONFIG}
        loading={false}
        exploreError={error.message}
      />
    );
  }

  if (!data) {
    return (
      <ExplorerChart
        exploreData={null}
        submittedExploreState={PLACEHOLDER_CONFIG}
        loading={false}
        exploreError={null}
      />
    );
  }

  return (
    <ExplorerChart
      exploreData={data.results}
      submittedExploreState={data.config}
      loading={false}
      exploreError={null}
    />
  );
}
