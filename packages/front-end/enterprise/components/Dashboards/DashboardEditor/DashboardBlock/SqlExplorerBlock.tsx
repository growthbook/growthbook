import { SqlExplorerBlockInterface } from "back-end/src/enterprise/validators/dashboard-block";
import { SqlExplorerDataVisualization } from "@/components/DataViz/SqlExplorerDataVisualization";
import { BlockProps } from ".";

export default function SqlExplorerBlock({
  block,
  savedQuery,
}: BlockProps<SqlExplorerBlockInterface>) {
  const { dataVizConfigIndex } = block;

  const dataVizConfig = savedQuery.dataVizConfig?.[dataVizConfigIndex];
  if (!dataVizConfig) return null; // Warning state handled by parent component

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
