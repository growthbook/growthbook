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
  const { getFactMetricById } = useDefinitions();
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

  // Comparison is resolved through the shared seam so a future dashboard-wide
  // compare toggle drives this the same way. The previous-period exploration is
  // a separate entity produced on refresh; fetch it when present. Skipped on the
  // public page (explorationProp provided) since it would fire an authed request.
  const comparison = resolveBlockComparison(block);
  const compareEnabled = !!comparison?.enabled;
  const { data: comparisonData } = useApi<{
    status: number;
    exploration: ProductAnalyticsExploration;
    query: QueryInterface | null;
  }>(`/product-analytics/exploration/${block.comparisonExplorerAnalysisId}`, {
    shouldRun: () =>
      !explorationProp &&
      compareEnabled &&
      !!block.comparisonExplorerAnalysisId,
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
          comparisonExploration={comparisonExploration}
          compareEnabled={compareEnabled}
          serverTableTrendsByRow={comparisonPayload?.tableTrendsByRow ?? null}
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
          comparisonExploration={comparisonExploration}
          compareEnabled={compareEnabled}
          submittedPreviousTimeFrame={submittedPreviousTimeFrame}
          serverBigNumberTrends={comparisonPayload?.bigNumberTrends ?? null}
          error={exploration.error || errorMessage}
          loading={loading}
          submittedExploreState={block.config ?? exploration.config}
        />
      )}
    </Flex>
  );
}
