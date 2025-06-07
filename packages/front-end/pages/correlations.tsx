import { Box, Heading } from "@radix-ui/themes";
import MetricCorrelations from "@/enterprise/components/Insights/MetricCorrelations";

const MetricCorrelationsPage = (): React.ReactElement => {
  return (
    <Box className="contents container-fluid pagecontents my-3">
      <Heading>Metric Correlations</Heading>
      <MetricCorrelations />
    </Box>
  );
};

export default MetricCorrelationsPage;
