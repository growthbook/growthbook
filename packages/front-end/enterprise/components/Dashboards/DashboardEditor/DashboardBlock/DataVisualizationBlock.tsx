import { useMemo } from "react";
import { DataVisualizationBlockInterface } from "shared/enterprise";
import { SavedQuery } from "shared/validators";
import { SqlExplorerDataVisualization } from "@/components/DataViz/SqlExplorerDataVisualization";
import { BlockProps } from ".";

// This is where we'll actually render the data visualization for the block. This isn't the component where the user edits the data for the block
export default function DataVisualizationBlock({
  block,
  savedQuery,
}: BlockProps<DataVisualizationBlockInterface> & { savedQuery?: SavedQuery }) {
  const rows = useMemo(() => {
    if (
      block.dataSourceConfig?.dataType === "sql" &&
      savedQuery?.results?.results
    ) {
      return savedQuery.results.results;
    }
    return [];
  }, [block.dataSourceConfig?.dataType, savedQuery?.results?.results]);

  const dataVizConfig = useMemo(() => {
    return block.dataVizConfig?.[0]; // Currently only supports a single visualization per block
  }, [block.dataVizConfig]);

  if (!dataVizConfig) {
    return <div>No visualization configuration found.</div>;
  }

  if (block.dataSourceConfig?.dataType === "sql") {
    if (!savedQuery?.results?.results) {
      return <div>No data available.</div>;
    }

    return (
      <SqlExplorerDataVisualization
        rows={rows}
        dataVizConfig={dataVizConfig}
        onDataVizConfigChange={() => {}}
        showPanel={false}
        graphTitle={""}
      />
    );
  }

  // For metric data source, return placeholder
  if (block.dataSourceConfig?.dataType === "metric") {
    return <div>This is where the metric viz will go</div>;
  }

  // Fallback for unknown data source type
  return <div>Unknown data source type.</div>;
}
