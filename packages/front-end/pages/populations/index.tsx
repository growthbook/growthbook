import { Box, Flex } from "@radix-ui/themes";
import Heading from "@/ui/Heading";
import PageHead from "@/components/Layout/PageHead";

export default function PopulationsPage() {
  return (
    <Box className="pagecontents container-fluid">
      <PageHead breadcrumb={[{ display: "Populations" }]} />
      <Flex align="center" justify="between" gap="3" mb="4">
        <Heading as="h1" size="xl" mb="0">
          Populations
        </Heading>
      </Flex>
    </Box>
  );
}
