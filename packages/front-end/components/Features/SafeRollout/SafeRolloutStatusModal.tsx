import { useForm } from "react-hook-form";

import { SafeRolloutInterface } from "back-end/src/models/SafeRolloutModel";
import { useAuth } from "@/services/auth";
import Modal from "@/components/Modal";
export interface Props {
  safeRollout: SafeRolloutInterface;
  open: boolean;
  setStatusModalOpen: (open: boolean) => void;
  mutate?: () => void;
}

export default function SafeRolloutStatusModal({
  safeRollout,
  open,
  setStatusModalOpen,
  mutate,
}: Props) {
  const { apiCall } = useAuth();
  const onSubmit = async () => {
    await apiCall(`/safe-rollout/revert/${safeRollout.id}`, {
      method: "POST",
    });
    mutate?.();
    setStatusModalOpen(false);
  };
  console.log(open);
  return (
    <Modal
      open={open}
      close={() => setStatusModalOpen(false)}
      header={`Revert Safe Rollout`}
      submit={() => onSubmit()}
      size="lg"
      bodyClassName="px-4 pt-4"
      trackingEventModalType={""}
    >
      <div>
        warning: You are about to revert the safe rollout back to the control
        group.
      </div>
    </Modal>
  );
}
