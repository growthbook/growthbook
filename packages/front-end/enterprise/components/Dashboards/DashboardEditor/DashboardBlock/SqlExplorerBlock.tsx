import { SqlExplorerBlockInterface } from "back-end/src/enterprise/validators/dashboard-block";
import { SavedQuery } from "back-end/src/validators/saved-queries";
import useApi from "@/hooks/useApi";
import { SqlExplorerDataVisualization } from "@/components/DataViz/SqlExplorerDataVisualization";
import LoadingSpinner from "@/components/LoadingSpinner";
import Callout from "@/components/Radix/Callout";
import { BLOCK_TYPE_INFO } from "..";
import { BlockProps } from ".";

export default function SqlExplorerBlock({
  block,
}: BlockProps<SqlExplorerBlockInterface>) {
  const { savedQueryId, dataVizConfigIndex } = block;
  const { data: savedQueriesData, isLoading } = useApi<{
    status: number;
    savedQueries: SavedQuery[];
  }>(`/saved-queries/`);
  if (isLoading) return <LoadingSpinner />;
  if (!savedQueriesData)
    return (
      <Callout status="error">
        Failed to load saved queries, try again later
      </Callout>
    );

  const savedQuery = savedQueriesData.savedQueries?.find(
    (q: SavedQuery) => q.id === savedQueryId
  );
  const dataVizConfig = savedQuery?.dataVizConfig?.[dataVizConfigIndex];

  if (!savedQuery || !dataVizConfig)
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
