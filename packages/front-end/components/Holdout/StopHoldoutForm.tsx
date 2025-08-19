import { FC } from "react";
import { HoldoutInterface } from "back-end/src/routers/holdout/holdout.validators";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import ConfirmModal from "../ConfirmModal";

const StopHoldoutForm: FC<{
  holdout: HoldoutInterface;
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
  close: () => void;
  source?: string;
}> = ({ holdout, experiment, close, mutate }) => {
  const { apiCall } = useAuth();

  const submit = async () => {
    try {
      await apiCall(`/holdout/${holdout.id}/edit-status`, {
        method: "POST",
        body: JSON.stringify({
          status: "stopped",
        }),
      });
    } catch (error) {
      console.error(error);
    }

    track("Stop Holdout", {
      previousStatus: experiment.status,
    });

    mutate();
  };

  return (
    <ConfirmModal
      title={"Stop Holdout"}
      subtitle="Stopping this holdout will release all holdout users and will expose them to the same feature values as the general population."
      yesText="Stop"
      noText="Cancel"
      modalState={true}
      setModalState={() => close()}
      onConfirm={async () => {
        await submit();
        close();
      }}
    />
  );
};

export default StopHoldoutForm;
