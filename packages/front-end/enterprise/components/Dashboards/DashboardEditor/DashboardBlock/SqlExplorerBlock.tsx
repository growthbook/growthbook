import { Box, Flex, Text } from "@radix-ui/themes";
import { SqlExplorerBlockInterface } from "back-end/src/enterprise/validators/dashboard-block";
import { DataVizConfig } from "back-end/src/validators/saved-queries";
import {
  DataVisualizationDisplay,
  SqlExplorerDataVisualization,
} from "@/components/DataViz/SqlExplorerDataVisualization";
import DisplayTestQueryResults from "@/components/Settings/DisplayTestQueryResults";
import { BlockProps } from ".";

export default function SqlExplorerBlock({
  block,
  savedQuery,
}: BlockProps<SqlExplorerBlockInterface>) {
  // Backwards compatibility: Check if using the old dataVizConfigIndex approach
  if (block.dataVizConfigIndex !== undefined) {
    const dataVizConfig = savedQuery.dataVizConfig?.[block.dataVizConfigIndex];
    if (!dataVizConfig) return null; // Warning state handled by parent component

    return (
      <div>
        <SqlExplorerDataVisualization
          rows={savedQuery.results.results}
          dataVizConfig={dataVizConfig}
          onDataVizConfigChange={() => {}}
          showPanel={false}
          graphTitle={""}
        />
      </div>
    );
  }

  const blockConfig = block.blockConfig || [];

  // Find the dataVizConfig objects that match the titles in blockConfig
  const visualizations: { title: string; dataVizConfig: DataVizConfig }[] = [];

  for (const title of blockConfig) {
    const dataVizConfig = savedQuery.dataVizConfig?.find(
      (config) => config.title === title,
    );
    if (dataVizConfig) {
      visualizations.push({ title, dataVizConfig });
    }
  }

  return (
    <Flex direction="column" gap="4" p="4">
      {block.showResultsTable ? (
        <Box
          style={{
            height: 500,
            position: "relative",
            overflow: "auto",
          }}
        >
          <DisplayTestQueryResults
            duration={savedQuery.results?.duration || 0}
            results={savedQuery.results?.results || []}
            sql={savedQuery.results?.sql || ""}
            error={savedQuery.results?.error || ""}
            allowDownload={true}
            showSampleHeader={false}
            renderedSQLLabel="SQL"
          />
        </Box>
      ) : null}
      {/* MKTODO: If block.showResultsTable is true, we need to show the results table here in addition to the visualizations */}
      {visualizations.map(({ title, dataVizConfig }, index) => (
        <Box key={`${title}-${index}`} style={{ minHeight: "300px" }}>
          <Text
            size="3"
            weight="medium"
            style={{
              color: "var(--color-text-high)",
              marginBottom: "12px",
              display: "block",
            }}
          >
            {title}
          </Text>
          <DataVisualizationDisplay
            rows={savedQuery.results.results}
            dataVizConfig={dataVizConfig}
          />
        </Box>
      ))}
    </Flex>
  );
}
