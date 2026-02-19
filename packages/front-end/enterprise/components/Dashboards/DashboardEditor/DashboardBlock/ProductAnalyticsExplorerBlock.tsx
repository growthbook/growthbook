import {
  MetricExplorationBlockInterface,
  FactTableExplorationBlockInterface,
  DataSourceExplorationBlockInterface,
} from "shared/enterprise";
import { Box } from "@radix-ui/themes";
import Text from "@/ui/Text";
import { BlockProps } from ".";

export default function ProductAnalyticsExplorerBlock({
  block,
  // MKTODO: Can we make this a discriminated union?
}: BlockProps<
  | MetricExplorationBlockInterface
  | FactTableExplorationBlockInterface
  | DataSourceExplorationBlockInterface
>) {
  if (!block.explorerAnalysisId) {
    return (
      <Box p="4" style={{ textAlign: "center" }}>
        <Text>Configure this block to display explorer data.</Text>
      </Box>
    );
  }
  return (
    <Box p="4" style={{ textAlign: "center" }}>
      <Text>
        Product Analytics Explorer (explorerAnalysisId:{" "}
        {block.explorerAnalysisId})
      </Text>
    </Box>
  );
}
