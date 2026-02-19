import { ProductAnalyticsExplorerBlockInterface } from "shared/enterprise";
import { Box } from "@radix-ui/themes";
import Text from "@/ui/Text";
import { BlockProps } from ".";

export default function ProductAnalyticsExplorerBlock({
  block,
}: BlockProps<ProductAnalyticsExplorerBlockInterface>) {
  if (!block.explorerAnalysisId) {
    return (
      <Box p="4" style={{ textAlign: "center" }}>
        <Text>Configure this block to display metric explorer data.</Text>
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
