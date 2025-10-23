import React, { useState } from "react";
import { isEmpty } from "lodash";
import { ExperimentTemplateInterface } from "back-end/types/experiment";
import { Box, Flex, Heading } from "@radix-ui/themes";
import { TemplatesPage } from "@/components/Experiment/Templates/TemplatesPage";
import TemplateForm from "@/components/Experiment/Templates/TemplateForm";
import Button from "@/ui/Button";
import { useUser } from "@/services/UserContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useDefinitions } from "@/services/DefinitionsContext";

const ExperimentTemplatesPage: React.FC = () => {
  const { project } = useDefinitions();
  const [openTemplateModal, setOpenTemplateModal] = useState<
    Partial<ExperimentTemplateInterface> | undefined
  >(undefined);
  const [openDuplicateTemplateModal, setOpenDuplicateTemplateModal] = useState<
    undefined | ExperimentTemplateInterface
  >(undefined);
  const { hasCommercialFeature } = useUser();
  const permissionsUtil = usePermissionsUtil();
  const hasTemplatesFeature = hasCommercialFeature("templates");
  const canAddTemplate =
    permissionsUtil.canViewExperimentTemplateModal(project);

  return (
    <>
      <Box className="contents experiments container-fluid pagecontents">
        <Flex mb="4" mt="2" align="center" justify="between">
          <Heading as="h1" mb="0">
            Experiment Templates
          </Heading>
          <Button
            onClick={() => setOpenTemplateModal({})}
            disabled={!hasTemplatesFeature || !canAddTemplate}
          >
            Add Template
          </Button>
        </Flex>
        <TemplatesPage
          setOpenTemplateModal={setOpenTemplateModal}
          setOpenDuplicateTemplateModal={setOpenDuplicateTemplateModal}
        />
      </Box>
      {openTemplateModal && (
        <TemplateForm
          onClose={() => setOpenTemplateModal(undefined)}
          initialValue={openTemplateModal}
          source="templates-list"
          isNewTemplate={isEmpty(openTemplateModal)}
        />
      )}
      {openDuplicateTemplateModal && (
        <TemplateForm
          onClose={() => setOpenDuplicateTemplateModal(undefined)}
          initialValue={openDuplicateTemplateModal}
          source="templates-list"
          isNewTemplate={isEmpty(openTemplateModal)}
          duplicate
        />
      )}
    </>
  );
};

export default ExperimentTemplatesPage;
