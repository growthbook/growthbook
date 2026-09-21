import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { ExperimentType } from "shared/validators";
import { useAuth } from "@/services/auth";
import InlineMarkdownField from "@/components/Experiment/TabbedPage/InlineMarkdownField";

function getExperimentTypeName(experimentType: ExperimentType) {
  switch (experimentType) {
    case "standard":
      return "experiment";
    case "holdout":
      return "holdout";
    case "multi-armed-bandit":
      return "bandit";
  }
}

export function getExperimentDescriptionPlaceholder(
  experimentType: ExperimentType,
) {
  const name = getExperimentTypeName(experimentType);
  return `Add context about this ${name} for your team`;
}

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
