import React, { useState } from "react";
import { isEmpty } from "lodash";
import { ExperimentTemplateInterface } from "back-end/types/experiment";
import { Box, Flex, Heading } from "@radix-ui/themes";
import { PiCaretDown } from "react-icons/pi";
import { TemplatesPage } from "@/components/Experiment/Templates/TemplatesPage";
import TemplateForm from "@/components/Experiment/Templates/TemplateForm";
import {
  DropdownMenu,
  DropdownMenuItem,
} from "@/components/Radix/DropdownMenu";
import Button from "@/components/Radix/Button";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
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
  const canAddTemplate = permissionsUtil.canViewExperimentTemplateModal(
    project
  );

  const addExperimentDropdownButton = (
    <DropdownMenu
      trigger={
        <Button icon={<PiCaretDown />} iconPosition="right">
          Add
        </Button>
      }
      menuPlacement="end"
    >
      {canAddTemplate && (
        <DropdownMenuItem
          onClick={() => setOpenTemplateModal({})}
          disabled={!hasTemplatesFeature}
        >
          <PremiumTooltip commercialFeature="templates">
            Create Template
          </PremiumTooltip>
        </DropdownMenuItem>
      )}
    </DropdownMenu>
  );

  return (
    <>
      <Box className="contents experiments container-fluid pagecontents">
        <Flex mb="4" mt="2" align="center" justify="between">
          <Heading as="h1" mb="0">
            Experiment Templates
          </Heading>
          {addExperimentDropdownButton}
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
