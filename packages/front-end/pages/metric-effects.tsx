import { Box } from "@radix-ui/themes";
import MetricEffects from "@/enterprise/components/Insights/MetricEffects";
import Text from "@/ui/Text";
import Heading from "@/ui/Heading";

const MetricEffectsPage = (): React.ReactElement => {
  return (
    <Box className="contents container-fluid pagecontents my-3">
      <Heading>Metric Effects</Heading>
      <Box mb="2">
        <Text>
          View the distribution of experiment impacts on the selected metric.
        </Text>
      </Box>
      <MetricEffects />
    </Box>
  );
};

export default MetricEffectsPage;
