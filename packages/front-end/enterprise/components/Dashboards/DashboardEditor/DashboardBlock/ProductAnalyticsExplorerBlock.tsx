import { Box, Flex } from "@radix-ui/themes";
import { useMemo } from "react";
import {
  MetricExplorationBlockInterface,
  FactTableExplorationBlockInterface,
  DataSourceExplorationBlockInterface,
  resolveBlockComparison,
  computeExplorationComparisonPayload,
} from "shared/enterprise";
import { ProductAnalyticsExploration } from "shared/validators";
import { QueryInterface } from "shared/types/query";
import useApi from "@/hooks/useApi";
import { useDefinitions } from "@/services/DefinitionsContext";
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
  const { getFactMetricById } = useDefinitions();
  const { data, error, isLoading } = useApi<{
    status: number;
    exploration: ProductAnalyticsExploration;
    query: QueryInterface | null;
  }>(`/product-analytics/exploration/${block.explorerAnalysisId}`, {
    shouldRun: () => !!block.explorerAnalysisId,
  });

  // Comparison is resolved through the shared seam so a future dashboard-wide
  // compare toggle drives this the same way. The previous-period exploration is
  // a separate entity produced on refresh; fetch it when present.
  const comparison = resolveBlockComparison(block);
  const compareEnabled = !!comparison?.enabled;
  const { data: comparisonData } = useApi<{
    status: number;
    exploration: ProductAnalyticsExploration;
    query: QueryInterface | null;
  }>(`/product-analytics/exploration/${block.comparisonExplorerAnalysisId}`, {
    shouldRun: () => compareEnabled && !!block.comparisonExplorerAnalysisId,
  });
  const rawComparisonExploration = comparisonData?.exploration ?? null;
  // The resolved previous window lives on the comparison exploration's config.
  const submittedPreviousTimeFrame =
    rawComparisonExploration?.config?.dateRange ?? null;

  // Dashboard blocks fetch the saved primary + previous explorations directly,
  // bypassing POST /product-analytics/run — where the live Explorer builds its
  // comparison payload via computeExplorationComparisonPayload (densified rows +
  // trends). Recreate that payload here with the same shared helper so the
  // dashboard matches the Explorer: empty previous periods densify to zeros
  // instead of triggering the "no data, nothing to compare" message, and
  // big-number / table trends are computed identically.
  const submittedConfig = block.config ?? data?.exploration?.config ?? null;
  const comparisonPayload = useMemo(() => {
    if (
      !compareEnabled ||
      !data?.exploration ||
      !submittedConfig ||
      !submittedPreviousTimeFrame
    ) {
      return null;
    }
    return computeExplorationComparisonPayload(
      data.exploration,
      rawComparisonExploration,
      submittedConfig,
      submittedPreviousTimeFrame,
      (id) => getFactMetricById(id) ?? null,
    );
  }, [
    compareEnabled,
    data?.exploration,
    rawComparisonExploration,
    submittedConfig,
    submittedPreviousTimeFrame,
    getFactMetricById,
  ]);

  // Use the densified comparison exploration from the payload (matching the
  // Explorer) rather than the raw fetched one.
  const comparisonExploration = comparisonPayload?.exploration ?? null;

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
    <Flex direction="column" gap="2" style={{ height: "100%" }}>
      {shouldShowTable ? (
        <ExplorerDataTable
          exploration={data.exploration}
          comparisonExploration={comparisonExploration}
          compareEnabled={compareEnabled}
          serverTableTrendsByRow={comparisonPayload?.tableTrendsByRow ?? null}
          error={data.exploration.error ?? error?.message ?? null}
          submittedExploreState={block.config ?? data.exploration.config}
          loading={isLoading}
          hasChart={false}
          query={data?.query ?? null}
        />
      ) : (
        <ExplorerChart
          exploration={data?.exploration}
          comparisonExploration={comparisonExploration}
          compareEnabled={compareEnabled}
          submittedPreviousTimeFrame={submittedPreviousTimeFrame}
          serverBigNumberTrends={comparisonPayload?.bigNumberTrends ?? null}
          error={data?.exploration.error || error?.message || null}
          loading={isLoading}
          submittedExploreState={block.config ?? data?.exploration.config}
        />
      )}
    </Flex>
  );
}
