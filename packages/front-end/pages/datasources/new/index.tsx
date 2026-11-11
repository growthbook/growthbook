import { FC } from "react";
import { Box } from "@radix-ui/themes";
import PageHead from "@/components/Layout/PageHead";
import DataSourceOptionsTable from "@/components/DataSourceSetup/DataSourceOptionsTable";
import Heading from "@/ui/Heading";

const NewDataSourcePage: FC = () => {
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
