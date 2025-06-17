import React, { FC } from "react";
import { Flex, Box } from "@radix-ui/themes";
import NewExperimentForm from "@/components/Experiment/NewExperimentForm";
import PageHead from "@/components/Layout/PageHead";

const NewExperimentPage: FC = () => {
  return (
    <Box className="contents experiments container-fluid pagecontents">
      <PageHead
        breadcrumb={[
          {
            display: "Experiments",
            href: `/experiments`,
          },
          { display: "Create experiment" },
        ]}
      />

      <Flex gap="5">
        <Box flexBasis="65%">
          <NewExperimentForm
            onClose={() => {}}
            source="experiment-list"
            isNewExperiment={true}
            inline={true}
          />
        </Box>
        <Box flexBasis="35%">right</Box>
      </Flex>
    </Box>
  );
};

export default NewExperimentPage;
