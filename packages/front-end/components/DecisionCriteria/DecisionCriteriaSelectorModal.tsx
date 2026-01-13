import { FC, useState } from "react";
import { Box, Flex, Text } from "@radix-ui/themes";
import {
  DecisionCriteriaData,
  ExperimentInterfaceStringDates,
} from "shared/types/experiment";
import { PRESET_DECISION_CRITERIAS } from "shared/enterprise";
import { useForm } from "react-hook-form";
import Modal from "@/components/Modal";
import Callout from "@/ui/Callout";
import useApi from "@/hooks/useApi";
import { Select, SelectItem } from "@/ui/Select";
import { useDecisionCriteriaForm } from "@/hooks/useDecisionCriteriaForm";
import DecisionCriteriaModalContent from "@/components/DecisionCriteria/DecisionCriteriaModalContent";
import { useAuth } from "@/services/auth";

interface DecisionCriteriaSelectorModalProps {
  onSubmit: () => void;
  onClose: () => void;
  initialCriteria?: DecisionCriteriaData;
  experiment: ExperimentInterfaceStringDates;
  canEdit: boolean;
}

const DecisionCriteriaSelectorModal: FC<DecisionCriteriaSelectorModalProps> = ({
  onSubmit,
  onClose,
  experiment,
  initialCriteria,
  canEdit,
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

  const { apiCall } = useAuth();

  const decisionCriteriaFormProps = useDecisionCriteriaForm({
    decisionCriteria: selectedCriteria,
    mutate: () => {}, // not editable here
  });

  return (
    <Modal
      open={true}
      submit={
        canEdit
          ? form.handleSubmit(async (value) => {
              apiCall(`/experiment/${experiment.id}`, {
                method: "POST",
                body: JSON.stringify({
                  decisionFrameworkSettings: {
                    ...experiment.decisionFrameworkSettings,
                    decisionCriteriaId: value.decisionCriteriaId,
                  },
                }),
              }).then(() => {
                onSubmit();
              });
            })
          : undefined
      }
      close={onClose}
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
            size="2"
            disabled={!canEdit}
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
    </Modal>
  );
};

export default DecisionCriteriaSelectorModal;
