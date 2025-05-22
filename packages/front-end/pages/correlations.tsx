import { Box, Heading } from "@radix-ui/themes";
import MetricCorrelations from "@/enterprise/components/Insights/MetricCorrelations";

const MetricCorrelationsPage = (): React.ReactElement => {
  return (
    <Box className="container-fluid">
      <Heading>Metric Correlations</Heading>
      <MetricCorrelations />
    </Box>
  );
};

export default MetricCorrelationsPage;
