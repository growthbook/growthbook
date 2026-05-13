import type {
  ExplorationConfig,
  ProductAnalyticsExploration,
} from "shared/validators";
import type { QueryInterface } from "shared/types/query";
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
  compareEnabled = false,
  comparisonExploration = null,
}: {
  exploration: ProductAnalyticsExploration | null;
  error: string | null;
  submittedExploreState: ExplorationConfig | null;
  loading: boolean;
  hasChart?: boolean;
  isStale?: boolean;
  query?: QueryInterface | null;
  compareEnabled?: boolean;
  comparisonExploration?: ProductAnalyticsExploration | null;
}) {
  const {
    rowData,
    orderedColumnKeys,
    columnLabels,
    headerStructure,
    explorationReturnedNoData,
    csvColumnKeys,
    csvColumnLabels,
    renderCell,
  } = useExplorationTableData(exploration, submittedExploreState, {
    compareEnabled,
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
      csvColumnKeys={csvColumnKeys}
      csvColumnLabels={csvColumnLabels}
      renderCell={renderCell}
      paddingTop={(isStale || loading) && !hasChart ? 35 : 0}
    />
  );
}
