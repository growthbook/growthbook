import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { useState } from "react";
import { HoldoutInterface } from "shared/src/validators/holdout";
import Modal from "@/components/Modal";
import Callout from "@/ui/Callout";
import { useAuth } from "@/services/auth";
import track from "@/services/track";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  holdout: HoldoutInterface;
  close: () => void;
  mutate: () => void;
}

export default function StopHoldoutModal({
  holdout,
  experiment,
  close,
  mutate,
}: Props) {
  const [startError, setStartError] = useState<string | null>(null);
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
      setStartError(error);
    }

    track("Stop Holdout", {
      previousStatus: experiment.status,
    });

    mutate();
    close();
  };

  return (
    <Modal
      trackingEventModalType="stop-holdout"
      trackingEventModalSource="stop-holdout-modal"
      open={true}
      size="md"
      submit={submit}
      submitColor="danger"
      cta="Confirm"
      close={close}
      header="Stop Holdout"
    >
      <div className="p-2">
        <div>
          Stopping this holdout will release all holdout users and will expose
          them to the same feature values as the general population.
        </div>

        {startError && (
          <Callout status="error" mt="3">
            {startError}
          </Callout>
        )}
      </div>
    </Modal>
  );
}
