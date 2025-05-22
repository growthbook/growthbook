import { Box, Heading } from "@radix-ui/themes";
import Frame from "@/components/Radix/Frame";

const MetricEffectsPage = (): React.ReactElement => {
  return (
    <Box className="container-fluid">
      <Frame className="overflow-auto">
        <Heading>Metric Effects</Heading>
        <p>This is the metric effects page.</p>
      </Frame>
    </Box>
  );
};

export default MetricEffectsPage;
