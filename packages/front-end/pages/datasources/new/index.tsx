import { FC, useEffect } from "react";
import { useRouter } from "next/router";
import { Box } from "@radix-ui/themes";
import PageHead from "@/components/Layout/PageHead";
import LoadingOverlay from "@/components/LoadingOverlay";
import DataSourceOptionsTable from "@/components/DataSourceSetup/DataSourceOptionsTable";
import { useNewDataSourceOnboarding } from "@/hooks/useNewDataSourceOnboarding";
import Heading from "@/ui/Heading";

const NewDataSourcePage: FC = () => {
  const router = useRouter();
  const { enabled, ready } = useNewDataSourceOnboarding();

  useEffect(() => {
    if (ready && !enabled) router.replace("/datasources");
  }, [router, enabled, ready]);

  if (!enabled) {
    return <LoadingOverlay />;
  }

  return (
    // PROTOTYPE (set in review): left-aligned at the app-wide page
    // frame (global.scss): 32px on the sides, 24px on top, 32px at the
    // bottom (was 15px around, centred), its 1340px cap kept, as a form.
    <Box pt="5" pb="6" px="6" maxWidth="1340px">
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
