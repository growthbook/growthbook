import { ReactNode } from "react";
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
  /** Beside the stacked label, such as the description's own edit button. */
  labelAction?: ReactNode;
}

export default function DescriptionField({
  experiment,
  mutate,
  editable,
  stacked,
  labelAction,
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
      labelAction={labelAction}
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
