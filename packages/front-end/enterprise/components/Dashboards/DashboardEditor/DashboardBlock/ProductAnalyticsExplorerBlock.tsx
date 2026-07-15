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

export default function ProductAnalyticsExplorerBlock({
  block,
  hideSql,
  ssrPolyfills,
  dashboardGlobalControls,
  exploration: explorationProp,
  comparisonExploration: comparisonExplorationProp,
  query: queryProp,
}: BlockProps<
  | MetricExplorationBlockInterface
  | FactTableExplorationBlockInterface
  | DataSourceExplorationBlockInterface
> & {
  exploration?: ProductAnalyticsExploration;
  // Public page only: the previous-period exploration, supplied directly so we
  // can render the comparison without the authenticated fetch below.
  comparisonExploration?: ProductAnalyticsExploration | null;
  query?: QueryInterface | null;
}) {
  const { getFactMetricById: definitionsGetFactMetricById } = useDefinitions();
  // On the public page there's no DefinitionsContext; use the ssrPolyfills
  // lookup so ratio comparisons resolve correctly.
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
    shouldRun: () =>
      !explorationProp &&
      compareEnabled &&
      !!block.comparisonExplorerAnalysisId,
  });
  // Public page passes the comparison exploration directly (no authed fetch).
  const rawComparisonExploration =
    comparisonExplorationProp ?? comparisonData?.exploration ?? null;
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
  // A block only tracks the dashboard date control when it hasn't opted out.
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
          getFactMetricById={ssrPolyfills?.getFactMetricById}
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
          getFactMetricById={ssrPolyfills?.getFactMetricById}
        />
      )}
    </Flex>
  );
}
