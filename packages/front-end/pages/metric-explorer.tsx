import { Box } from "@radix-ui/themes";
import { MetricExplorer } from "@/components/DataViz/MetricExplorer";

export default function MetricExplorerPage() {
  return (
    <div className="container pagecontents">
      <h1>Metric Explorer</h1>
      <Box mt="4">
        <MetricExplorer />
      </Box>
    </div>
  );
}
