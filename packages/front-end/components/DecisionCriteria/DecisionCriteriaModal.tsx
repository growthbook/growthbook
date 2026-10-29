import { FC } from "react";
import { DecisionCriteriaData } from "shared/enterprise";
import Modal from "@/components/Modal";
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

  const subheader =
    "Define rules for automatic decision making based on experiment results";
  // Read-only, it can open over another dialog, which only this one stacks over.
  if (!editable) {
    return (
      <ModalStandard
        open
        header="View Decision Criteria"
        subheader={subheader}
        close={onClose}
        closeCta="Close"
        size="lg"
        trackingEventModalType="decision_criteria_create"
        trackingEventModalSource={trackingEventModalSource}
      >
        <DecisionCriteriaModalContent
          decisionCriteriaFormProps={decisionCriteriaFormProps}
          editable={false}
        />
      </ModalStandard>
    );
  }

  return (
    <Modal
      open={true}
      header="Modify Decision Criteria"
      subHeader={subheader}
      close={onClose}
      submit={decisionCriteriaFormProps.handleSave}
      cta="Save Decision Criteria"
      size="lg"
      trackingEventModalType="decision_criteria_create"
      trackingEventModalSource={trackingEventModalSource}
    >
      <DecisionCriteriaModalContent
        decisionCriteriaFormProps={decisionCriteriaFormProps}
        editable
      />
    </Modal>
  );
};

export default DecisionCriteriaModal;
