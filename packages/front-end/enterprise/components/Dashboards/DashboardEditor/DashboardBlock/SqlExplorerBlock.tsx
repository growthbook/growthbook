import { Box, Flex } from "@radix-ui/themes";
import {
  blockHasFieldOfType,
  isResultsTableItem,
  SqlExplorerBlockInterface,
} from "shared/enterprise";
import { isString } from "shared/util";
import { useMemo } from "react";
import {
  DataVisualizationDisplay,
  SqlExplorerDataVisualization,
} from "@/components/DataViz/SqlExplorerDataVisualization";
import DisplayTestQueryResults from "@/components/Settings/DisplayTestQueryResults";
import ScrollArea from "@/ui/ScrollArea";
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

    return (
      <ScrollArea fill direction="both" edgeCue="fade" style={{ flex: 1 }}>
        <SqlExplorerDataVisualization
          rows={savedQuery.results.results}
          dataVizConfig={dataVizConfig}
          onDataVizConfigChange={() => {}}
          showPanel={false}
          graphTitle={""}
        />
      </ScrollArea>
    );
  }

  const blockConfig = block.blockConfig || [];
  // Alone, the table or chart takes the block's size; stacked, they scroll.
  const alone = blockConfig.length === 1;

  // Process blockConfig to render items in order
  const renderItems = blockConfig.map((configId, index) => {
    if (isResultsTableItem(configId)) {
      // Render results table
      return (
        <Flex
          key={`${configId}-${index}`}
          direction="column"
          flexGrow={alone ? "1" : undefined}
          minHeight="0"
        >
          <Box
            style={{
              ...(alone ? { flex: 1, minHeight: 0 } : { height: 500 }),
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
            />
          </Box>
        </Flex>
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
          flexGrow={alone ? "1" : undefined}
          minHeight="0"
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
                blockId ? `sql-explorer-${blockId}-${configId}` : undefined
              }
            />
          </Box>
        </Flex>
      );
    }
  });

  const items = (
    <Flex direction="column" gap="4" flexGrow="1" minHeight="0">
      {renderItems}
    </Flex>
  );
  return alone ? (
    items
  ) : (
    <ScrollArea fill direction="both" edgeCue="fade" style={{ flex: 1 }}>
      {items}
    </ScrollArea>
  );
}
