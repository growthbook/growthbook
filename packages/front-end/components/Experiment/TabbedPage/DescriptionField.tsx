import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { useAuth } from "@/services/auth";
import { getExperimentDescriptionPlaceholder } from "@/components/Experiment/EditDescriptionModal";
import InlineMarkdownField from "@/components/Experiment/TabbedPage/InlineMarkdownField";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
  editable: boolean;
  stacked?: boolean;
}

export default function DescriptionField({
  experiment,
  mutate,
  editable,
  stacked,
}: Props) {
  const { apiCall } = useAuth();

  return (
    <InlineMarkdownField
      label="Description"
      value={experiment.description || ""}
      placeholder={getExperimentDescriptionPlaceholder(
        experiment.type ?? "standard",
      )}
      editable={editable}
      stacked={stacked}
      addLabel="Description"
      onSave={async (description) => {
        await apiCall(`/experiment/${experiment.id}`, {
          method: "POST",
          body: JSON.stringify({ description }),
        });
        mutate();
      }}
    />
  );
}
