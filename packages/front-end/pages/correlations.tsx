import { Box, Heading, Text } from "@radix-ui/themes";
import MetricCorrelations from "@/enterprise/components/Insights/MetricCorrelations";

const MetricCorrelationsPage = (): React.ReactElement => {
  return (
    <Box className="contents container-fluid pagecontents my-3">
      <Heading>Metric Correlations</Heading>
      <Box mb="2">
        <Text>View how two metrics are jointly impacted by experiments.</Text>
      </Box>
      <MetricCorrelations />
    </Box>
  );
};

export default MetricCorrelationsPage;
