import { FC } from "react";
import { DecisionCriteriaData } from "shared/enterprise";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import { useDecisionCriteriaForm } from "@/hooks/useDecisionCriteriaForm";
import DecisionCriteriaModalContent from "@/components/DecisionCriteria/DecisionCriteriaModalContent";

interface DecisionCriteriaModalProps {
  decisionCriteria?: DecisionCriteriaData;
  onClose: () => void;
  mutate: () => void;
  trackingEventModalSource?: string;
  editable?: boolean;
}

const DecisionCriteriaModal: FC<DecisionCriteriaModalProps> = ({
  decisionCriteria,
  onClose,
  mutate,
  trackingEventModalSource,
  editable = true,
}) => {
  const decisionCriteriaFormProps = useDecisionCriteriaForm({
    decisionCriteria,
    mutate,
  });

  return (
    <ModalStandard
      open={true}
      header={editable ? "Modify Decision Criteria" : "View Decision Criteria"}
      subheader="Define rules for automatic decision making based on experiment results"
      close={onClose}
      submit={editable ? decisionCriteriaFormProps.handleSave : undefined}
      cta={editable ? "Save Decision Criteria" : undefined}
      closeCta={editable ? "Cancel" : "Close"}
      size="lg"
      trackingEventModalType="decision_criteria_create"
      trackingEventModalSource={trackingEventModalSource}
    >
      <DecisionCriteriaModalContent
        decisionCriteriaFormProps={decisionCriteriaFormProps}
        editable={editable}
      />
    </ModalStandard>
  );
};

export default DecisionCriteriaModal;
