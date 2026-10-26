import { FC, useState } from "react";
import { Box, Flex, Text } from "@radix-ui/themes";
import { DecisionCriteriaData } from "shared/types/experiment";
import { PRESET_DECISION_CRITERIAS } from "shared/enterprise";
import { useForm } from "react-hook-form";
import Callout from "@/ui/Callout";
import useApi from "@/hooks/useApi";
import { Select, SelectItem } from "@/ui/Select";
import { useDecisionCriteriaForm } from "@/hooks/useDecisionCriteriaForm";
import DecisionCriteriaModalContent from "@/components/DecisionCriteria/DecisionCriteriaModalContent";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import { validatedSubmit } from "@/ui/Modal/validatedSubmit";

interface DecisionCriteriaSelectorModalProps {
  onSubmit: () => void;
  onClose: () => void;
  initialCriteria?: DecisionCriteriaData;
  // Holds the choice with the page's other unsaved edits.
  stageChanges: (decisionCriteriaId: string) => void;
}

const DecisionCriteriaSelectorModal: FC<DecisionCriteriaSelectorModalProps> = ({
  onSubmit,
  onClose,
  initialCriteria,
  stageChanges,
}) => {
  const { data } = useApi<{
    status: number;
    decisionCriteria: DecisionCriteriaData[];
  }>("/decision-criteria");

  const decisionCriterias = [
    ...PRESET_DECISION_CRITERIAS,
    ...(data?.decisionCriteria || []),
  ];

  const [selectedCriteria, setSelectedCriteria] = useState<
    DecisionCriteriaData | undefined
  >(initialCriteria);

  const form = useForm<{ decisionCriteriaId: string }>({
    defaultValues: {
      decisionCriteriaId: selectedCriteria?.id || "",
    },
  });

  const decisionCriteriaFormProps = useDecisionCriteriaForm({
    decisionCriteria: selectedCriteria,
    mutate: () => {}, // not editable here
  });

  return (
    <ModalStandard
      open={true}
      submit={validatedSubmit(form, (value) => {
        stageChanges(value.decisionCriteriaId);
        onSubmit();
      })}
      close={onClose}
      cta="Confirm"
      header="Experiment Decision Criteria"
      trackingEventModalType="decision_criteria_selector"
      size="lg"
    >
      <Flex direction="column" gap="4">
        <Box mb="2">
          <Flex justify="between" align="center" mb="2">
            <Text as="label" weight="bold">
              Select Decision Criteria
            </Text>
          </Flex>
          <Select
            value={selectedCriteria?.id || ""}
            setValue={(value) => {
              setSelectedCriteria(
                decisionCriterias.find((c) => c.id === value),
              );
              form.setValue("decisionCriteriaId", value);
            }}
            size="md"
          >
            {decisionCriterias.map((criteria) => (
              <SelectItem key={criteria.id} value={criteria.id}>
                <Text weight="bold">{criteria.name}</Text>
                {criteria.description ? (
                  <Text color="gray">{`: ${criteria.description}`}</Text>
                ) : null}
              </SelectItem>
            ))}
          </Select>
        </Box>

        {selectedCriteria && (
          <>
            <Callout status="info" mb="2">
              Decision criteria can only be created or edited by organization
              admins in the organization settings page.
            </Callout>
            <DecisionCriteriaModalContent
              decisionCriteriaFormProps={decisionCriteriaFormProps}
              editable={false}
            />
          </>
        )}
      </Flex>
    </ModalStandard>
  );
};

export default DecisionCriteriaSelectorModal;
