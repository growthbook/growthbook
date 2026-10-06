import { useState } from "react";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import SelectOwner from "@/components/Owner/SelectOwner";
import { useAuth } from "@/services/auth";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";

// Edits only the experiment's owner, from the Setup page's rail. Same
// SelectOwner as EditExperimentInfoModal, so both behave identically.
export default function EditOwnerModal({
  experiment,
  close,
  mutate,
}: {
  experiment: ExperimentInterfaceStringDates;
  close: () => void;
  mutate: () => void;
}) {
  const { apiCall } = useAuth();
  const [owner, setOwner] = useState(experiment.owner || "");

  return (
    <ModalStandard
      open
      close={close}
      header="Edit Owner"
      cta="Apply"
      ctaEnabled={owner !== (experiment.owner || "")}
      trackingEventModalType="edit-experiment-owner"
      trackingEventModalSource="experiment-setup-rail"
      submit={async () => {
        await apiCall(`/experiment/${experiment.id}`, {
          method: "POST",
          body: JSON.stringify({ owner }),
        });
        mutate();
      }}
    >
      <SelectOwner value={owner} onChange={setOwner} />
    </ModalStandard>
  );
}
