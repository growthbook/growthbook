import { Box, Flex } from "@radix-ui/themes";
import { useMemo } from "react";
import {
  MetricExplorationBlockInterface,
  FactTableExplorationBlockInterface,
  DataSourceExplorationBlockInterface,
  blockUsesDashboardDateControl,
  getEffectiveExplorationConfig,
  getExplorationDateControlFingerprint,
  resolveBlockComparison,
  computeExplorationComparisonPayload,
} from "shared/enterprise";
import { isEqual } from "lodash";
import { ProductAnalyticsExploration } from "shared/validators";
import { QueryInterface } from "shared/types/query";
import useApi from "@/hooks/useApi";
import { useDefinitions } from "@/services/DefinitionsContext";
import ExplorerChart from "@/enterprise/components/ProductAnalytics/MainSection/ExplorerChart";
import ExplorerDataTable from "@/enterprise/components/ProductAnalytics/MainSection/ExplorerDataTable";
import LoadingSpinner from "@/components/LoadingSpinner";
import Callout from "@/ui/Callout";
import { BlockProps } from ".";

// The public page supplies the exploration data directly so blocks render
// without the authenticated fetches below.
type ProductAnalyticsExplorerBlockProps = BlockProps<
  | MetricExplorationBlockInterface
  | FactTableExplorationBlockInterface
  | DataSourceExplorationBlockInterface
> & {
  exploration?: ProductAnalyticsExploration;
  comparisonExploration?: ProductAnalyticsExploration | null;
  query?: QueryInterface | null;
};

export default function ProductAnalyticsExplorerBlock({
  block,
  hideSql,
  ssrPolyfills,
  dashboardGlobalControls,
  exploration: explorationProp,
  comparisonExploration: comparisonExplorationProp,
  query: queryProp,
}: ProductAnalyticsExplorerBlockProps) {
  const { getFactMetricById: definitionsGetFactMetricById } = useDefinitions();
  // ssrPolyfills covers the public page where there's no DefinitionsContext.
  const getFactMetricById =
    ssrPolyfills?.getFactMetricById ?? definitionsGetFactMetricById;
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

  // Comparison is resolved through the shared seam. The previous-period
  // exploration is a separate entity produced on refresh; fetch it when present.
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
  const rawComparisonExploration =
    comparisonExplorationProp ?? comparisonData?.exploration ?? null;
  const submittedPreviousTimeFrame =
    rawComparisonExploration?.config?.dateRange ?? null;

  // Recreate the Explorer's comparison payload with the same shared helper so
  // the dashboard matches it: densified previous periods plus big-number/table
  // trends, rather than the raw fetched explorations.
  const submittedConfig = useMemo(
    () =>
      block.config && dashboardGlobalControls
        ? getEffectiveExplorationConfig(block, {
            globalControls: dashboardGlobalControls,
          })
        : (block.config ?? data?.exploration?.config ?? null),
    [block, dashboardGlobalControls, data?.exploration?.config],
  );
  const submittedExplorationConfig = data?.exploration?.config;
  const usesDashboardDateRange =
    blockUsesDashboardDateControl(block) &&
    Boolean(dashboardGlobalControls?.dateRange);
  const hasStaleDashboardDateResults = useMemo(
    () =>
      usesDashboardDateRange &&
      submittedConfig !== null &&
      submittedExplorationConfig !== undefined &&
      !isEqual(
        getExplorationDateControlFingerprint(submittedConfig),
        getExplorationDateControlFingerprint(submittedExplorationConfig),
      ),
    [usesDashboardDateRange, submittedConfig, submittedExplorationConfig],
  );
  const comparisonPayload = useMemo(() => {
    if (
      !compareEnabled ||
      !exploration ||
      !submittedConfig ||
      !submittedPreviousTimeFrame
    ) {
      return null;
    }
    return computeExplorationComparisonPayload(
      exploration,
      rawComparisonExploration,
      submittedConfig,
      submittedPreviousTimeFrame,
      (id) => getFactMetricById(id) ?? null,
    );
  }, [
    compareEnabled,
    exploration,
    rawComparisonExploration,
    submittedConfig,
    submittedPreviousTimeFrame,
    getFactMetricById,
  ]);

  // Use the densified comparison exploration from the payload, not the raw one.
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

  if (hasStaleDashboardDateResults) {
    return (
      <Box p="4" style={{ textAlign: "center" }}>
        <Callout status="info">
          Global controls changed. Click the <code>Update</code> button to
          refresh this block.
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
          submittedExploreState={submittedConfig ?? exploration.config}
          loading={loading}
          hasChart={false}
          query={query}
          hideSql={hideSql}
          getFactMetricById={getFactMetricById}
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
          submittedExploreState={submittedConfig ?? exploration.config}
          getFactMetricById={getFactMetricById}
        />
      )}
    </Flex>
  );
}
