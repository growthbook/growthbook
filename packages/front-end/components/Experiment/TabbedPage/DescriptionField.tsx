import { ReactNode } from "react";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { useAuth } from "@/services/auth";
import InlineMarkdownField from "@/components/Experiment/TabbedPage/InlineMarkdownField";

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
