import type {
  ExplorationConfig,
  ProductAnalyticsExploration,
} from "shared/validators";
import type { QueryInterface } from "shared/types/query";
import { usesInlineComparison } from "@/enterprise/components/ProductAnalytics/compareUtil";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import DisplayTestQueryResults from "@/components/Settings/DisplayTestQueryResults";
import useExplorationTableData from "./useExplorationTableData";

export default function ExplorerDataTable({
  exploration,
  error,
  submittedExploreState,
  loading,
  hasChart = false,
  isStale = false,
  query = null,
}: {
  exploration: ProductAnalyticsExploration | null;
  error: string | null;
  submittedExploreState: ExplorationConfig | null;
  loading: boolean;
  hasChart?: boolean;
  isStale?: boolean;
  query?: QueryInterface | null;
}) {
  const { compareEnabled, comparisonExploration } = useExplorerContext();
  const inlineComparisonEnabled =
    compareEnabled &&
    !!submittedExploreState &&
    usesInlineComparison(submittedExploreState.chartType) &&
    submittedExploreState.chartType !== "bigNumber";

  const {
    rowData,
    exportRowData,
    orderedColumnKeys,
    columnLabels,
    headerStructure,
    explorationReturnedNoData,
  } = useExplorationTableData(exploration, submittedExploreState, {
    compareEnabled: inlineComparisonEnabled,
    comparisonExploration,
  });

  return (
    <DisplayTestQueryResults
      results={rowData}
      duration={query?.statistics?.executionDurationMs ?? 0}
      sql={query?.query || ""}
      error={error || ""}
      showNoRowsWarning={explorationReturnedNoData && !hasChart}
      allowDownload={true}
      showSampleHeader={false}
      showDuration={!!query?.statistics}
      headerStructure={headerStructure ?? undefined}
      orderedColumnKeys={orderedColumnKeys}
      columnLabels={columnLabels}
      csvResults={inlineComparisonEnabled ? exportRowData : undefined}
      paddingTop={(isStale || loading) && !hasChart ? 35 : 0}
    />
  );
}
