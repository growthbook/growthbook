import { Box, Heading } from "@radix-ui/themes";
import Frame from "@/components/Radix/Frame";

const MetricCorrelationsPage = (): React.ReactElement => {
  return (
    <Box className="container-fluid">
      <Frame className="overflow-auto">
        <Heading>Metric Correlations</Heading>
        <p>This is the metric correlations page.</p>
      </Frame>
    </Box>
  );
};

export default MetricCorrelationsPage;
