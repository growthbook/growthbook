import type {
  ExplorationConfig,
  ProductAnalyticsExploration,
} from "shared/validators";
import type { QueryInterface } from "shared/types/query";
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
  const tableComparisonEnabled = compareEnabled && !!submittedExploreState;

  const {
    rowData,
    exportRowData,
    orderedColumnKeys,
    columnLabels,
    headerStructure,
    explorationReturnedNoData,
  } = useExplorationTableData(exploration, submittedExploreState, {
    compareEnabled: tableComparisonEnabled,
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
      csvResults={tableComparisonEnabled ? exportRowData : undefined}
      paddingTop={(isStale || loading) && !hasChart ? 35 : 0}
    />
  );
}
