import { SafeRolloutInterface } from "back-end/src/models/SafeRolloutModel";
import { useState } from "react";
import { useAuth } from "@/services/auth";
import Modal from "@/components/Modal";
import RadioGroup from "@/components/Radix/RadioGroup";
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
    const status = radioSelected === "revert" ? "rolled-back" : "released";
    await apiCall(`/safe-rollout/${safeRollout.id}/status`, {
      method: "PUT",
      body: JSON.stringify({ status }),
    });
    mutate?.();
    setStatusModalOpen(false);
  };
  const [radioSelected, setRadioSelected] = useState<string>("revert");
  return (
    <Modal
      open={open}
      close={() => setStatusModalOpen(false)}
      header={`End Safe Rollout`}
      submit={() => onSubmit()}
      size="lg"
      bodyClassName="px-4 pt-4"
      trackingEventModalType={"updateSafeRolloutStatus"}
      allowlistedTrackingEventProps={{
        status: radioSelected,
      }}
    >
      <div>
        <RadioGroup
          value={radioSelected}
          setValue={(v) => {
            setRadioSelected(v);
          }}
          options={[
            { value: "revert", label: "Revert to 0%" },
            { value: "rollout", label: "Rollout to 100%" },
          ]}
        />
      </div>
    </Modal>
  );
}
