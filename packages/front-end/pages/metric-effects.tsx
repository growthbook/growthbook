import { Box, Heading } from "@radix-ui/themes";
import MetricEffects from "@/enterprise/components/Insights/MetricEffects";

const MetricEffectsPage = (): React.ReactElement => {
  return (
    <Box className="contents container-fluid pagecontents my-3">
      <Heading>Metric Effects</Heading>
      <MetricEffects />
    </Box>
  );
};

export default MetricEffectsPage;
