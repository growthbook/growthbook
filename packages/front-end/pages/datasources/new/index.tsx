import { FC, useEffect } from "react";
import { useRouter } from "next/router";
import { Box } from "@radix-ui/themes";
import { useGrowthBook } from "@growthbook/growthbook-react";
import PageHead from "@/components/Layout/PageHead";
import LoadingOverlay from "@/components/LoadingOverlay";
import DataSourceOptionsTable from "@/components/DataSourceSetup/DataSourceOptionsTable";
import { useNewDataSourceOnboarding } from "@/hooks/useNewDataSourceOnboarding";
import Heading from "@/ui/Heading";

const NewDataSourcePage: FC = () => {
  const router = useRouter();
  const growthbook = useGrowthBook();
  const enabled = useNewDataSourceOnboarding();
  // Flag values load asynchronously; don't redirect before they arrive.
  const flagsReady = !!growthbook?.ready;

  useEffect(() => {
    if (!enabled && flagsReady) router.replace("/datasources");
  }, [router, enabled, flagsReady]);

  if (!enabled) {
    return <LoadingOverlay />;
  }

  return (
    <Box p="15px" mx="auto" maxWidth="1340px">
      <PageHead
        breadcrumb={[
          { display: "Data Sources", href: "/datasources" },
          { display: "Add Data Source" },
        ]}
      />
      <Heading as="h1" size="xl" mb="5">
        Add Data Source
      </Heading>
      <DataSourceOptionsTable />
    </Box>
  );
};

export default NewDataSourcePage;
