import { SqlExplorerBlockInterface } from "back-end/src/enterprise/validators/dashboard-block";
import { useContext } from "react";
import { SavedQuery } from "back-end/src/validators/saved-queries";
import useApi from "@/hooks/useApi";
import { SqlExplorerDataVisualization } from "@/components/DataViz/SqlExplorerDataVisualization";
import LoadingSpinner from "@/components/LoadingSpinner";
import Callout from "@/components/Radix/Callout";
import { BLOCK_TYPE_INFO } from "..";
import { DashboardSnapshotContext } from "../../DashboardSnapshotProvider";
import { BlockProps } from ".";

export default function SqlExplorerBlock({
  block,
}: BlockProps<SqlExplorerBlockInterface>) {
  const { savedQueryId, dataVizConfigIndex } = block;
  const { savedQueriesMap, loading } = useContext(DashboardSnapshotContext);
  const savedQueryFromMap = savedQueriesMap.get(savedQueryId);
  // Use the API directly when the saved query hasn't been attached to the dashboard yet (when editing)
  const shouldRun = () => !savedQueryFromMap;
  const { data: savedQueryData, isLoading } = useApi<{
    status: number;
    savedQuery: SavedQuery;
  }>(`/saved-queries/${savedQueryId}`, { shouldRun });
  if (loading || isLoading) return <LoadingSpinner />;

  const savedQuery = savedQueryFromMap ?? savedQueryData?.savedQuery;
  if (savedQueryId.length > 0 && !savedQuery) {
    return <Callout status="error">Unable to find saved query</Callout>;
  }
  const dataVizConfig = savedQuery?.dataVizConfig?.[dataVizConfigIndex];

  if (savedQueryId.length === 0 || !dataVizConfig)
    return (
      <Callout status="info">
        This {BLOCK_TYPE_INFO[block.type].name} block requires additional
        configuration to display results.
      </Callout>
    );

  return (
    <div>
      <SqlExplorerDataVisualization
        rows={savedQuery.results.results}
        dataVizConfig={dataVizConfig}
        onDataVizConfigChange={() => {}}
        showPanel={false}
        graphTitle={block.title.length > 0 ? block.title : undefined}
      />
    </div>
  );
}
