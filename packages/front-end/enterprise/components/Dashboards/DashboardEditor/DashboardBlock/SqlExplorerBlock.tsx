import { Box, Flex } from "@radix-ui/themes";
import { SqlExplorerBlockInterface } from "back-end/src/enterprise/validators/dashboard-block";
import { isResultsTableItem, blockHasFieldOfType } from "shared/enterprise";
import { isString } from "shared/util";
import { useMemo } from "react";
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
  // Generate a unique ID for this block's charts
  const blockId = useMemo(() => {
    if (blockHasFieldOfType(block, "id", isString) && block.id) {
      return block.id;
    }
    return null;
  }, [block]);

  // Backwards compatibility: Check if using the old dataVizConfigIndex approach
  if (block.dataVizConfigIndex !== undefined) {
    const dataVizConfig = savedQuery.dataVizConfig?.[block.dataVizConfigIndex];
    if (!dataVizConfig) return null; // Warning state handled by parent component

    // For backwards compatibility, we can't easily pass chartId through SqlExplorerDataVisualization
    // This is fine - the new blockConfig approach will handle chart connections
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

  // Process blockConfig to render items in order
  const renderItems = blockConfig.map((configId, index) => {
    if (isResultsTableItem(configId)) {
      // Render results table
      return (
        <div key={`${configId}-${index}`}>
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
        </div>
      );
    } else {
      // Render visualization - try to find by ID first, then fallback to title
      const dataVizConfig = savedQuery.dataVizConfig?.find(
        (config) => config.id === configId || config.title === configId,
      );
      if (!dataVizConfig) return null;

      return (
        <Flex
          key={`${configId}-${index}`}
          py="5"
          align="center"
          justify="center"
          style={{
            border: "1px solid var(--gray-a3)",
            borderRadius: "var(--radius-4)",
          }}
        >
          <Box style={{ width: "100%", height: "100%" }}>
            <DataVisualizationDisplay
              rows={savedQuery.results.results}
              dataVizConfig={dataVizConfig}
              chartId={
                blockId
                  ? `sql-explorer-${blockId}-${configId}-${index}`
                  : undefined
              }
            />
          </Box>
        </Flex>
      );
    }
  });

  return (
    <Flex direction="column" gap="4">
      {renderItems}
    </Flex>
  );
}
