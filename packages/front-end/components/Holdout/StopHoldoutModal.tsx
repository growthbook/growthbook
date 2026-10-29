import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { HoldoutInterfaceStringDates } from "shared/validators";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  holdout: HoldoutInterfaceStringDates;
  close: () => void;
  mutate: () => void;
}

export default function StopHoldoutModal({
  holdout,
  experiment,
  close,
  mutate,
}: Props) {
  const { apiCall } = useAuth();

  // A refusal throws, so the modal stays open and shows it.
  const submit = async () => {
    await apiCall(`/holdout/${holdout.id}/edit-status`, {
      method: "POST",
      body: JSON.stringify({
        status: "stopped",
      }),
    });

    track("Stop Holdout", {
      previousStatus: experiment.status,
    });

    mutate();
  };

  return (
    <ModalStandard
      trackingEventModalType="stop-holdout"
      trackingEventModalSource="stop-holdout-modal"
      open={true}
      size="md"
      submit={submit}
      ctaColor="red"
      cta="Confirm"
      close={close}
      header="Stop Holdout"
    >
      <div className="p-2">
        <div>
          Stopping this holdout will release all holdout users and will expose
          them to the same feature values as the general population.
        </div>
      </div>
    </ModalStandard>
  );
}
