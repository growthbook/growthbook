import { ReactNode } from "react";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import InlineMarkdownField from "@/components/Experiment/TabbedPage/InlineMarkdownField";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  editable: boolean;
  stacked?: boolean;
  /** Beside the stacked label, such as the description's own edit button. */
  labelAction?: ReactNode;
}

export default function DescriptionField({
  experiment,
  editable,
  stacked,
  labelAction,
}: Props) {
  return (
    <InlineMarkdownField
      label="Description"
      experiment={experiment}
      field="description"
      editable={editable}
      stacked={stacked}
      labelAction={labelAction}
      addLabel="Description"
    />
  );
}
