import { useState } from "react";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { useAuth } from "@/services/auth";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import TextField from "@/ui/TextField";

// Edits only the experiment's name, from the header's kebab ("Edit Name") on
// the redesigned page. The rest of what Edit Info covered (project, owner,
// tags) is edited from the Setup page's rail.
export default function EditNameModal({
  experiment,
  close,
  mutate,
}: {
  experiment: ExperimentInterfaceStringDates;
  close: () => void;
  mutate: () => void;
}) {
  const { apiCall } = useAuth();
  const [name, setName] = useState(experiment.name);
  const trimmed = name.trim();

  return (
    <ModalStandard
      open
      close={close}
      header="Edit Experiment Name"
      cta="Apply"
      ctaEnabled={trimmed.length > 0 && trimmed !== experiment.name}
      trackingEventModalType="edit-experiment-name"
      trackingEventModalSource="experiment-more-menu"
      submit={async () => {
        await apiCall(`/experiment/${experiment.id}`, {
          method: "POST",
          body: JSON.stringify({ name: trimmed }),
        });
        mutate();
      }}
    >
      <TextField
        label="Experiment Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
        required
        markRequired
      />
    </ModalStandard>
  );
}
