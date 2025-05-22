import { Box, Heading } from "@radix-ui/themes";
import MetricEffects from "@/enterprise/components/Insights/MetricEffects";

const MetricEffectsPage = (): React.ReactElement => {
  return (
    <Box className="container-fluid">
      <Heading>Metric Effects</Heading>
      <MetricEffects />
    </Box>
  );
};

export default MetricEffectsPage;
