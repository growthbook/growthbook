import Modal from "../Modal";

interface Props {
  card?: unknown;
  onClose: () => void;
}

export default function CreditCardModal({ card, onClose }: Props) {
  return (
    <Modal
      open={true}
      trackingEventModalType="add-edit-credit-card"
      cta="Save Card"
      close={() => onClose()}
      header={`${card ? "Update" : "Add"} Default Card`}
    >
      Credit Card Modal
    </Modal>
  );
}
