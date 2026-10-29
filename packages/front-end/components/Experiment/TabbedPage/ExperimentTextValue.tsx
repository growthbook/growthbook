import Markdown from "@/components/Markdown/Markdown";
import Text from "@/ui/Text";
import ExpandableBlock from "./ExpandableBlock";

export const EXPERIMENT_TEXT_FIELDS = {
  hypothesis: {
    label: "Hypothesis",
    placeholder: "What do you expect to happen, and why?",
  },
  description: {
    label: "Description",
    placeholder: "What is this experiment about?",
  },
};

export type ExperimentTextFieldKey = keyof typeof EXPERIMENT_TEXT_FIELDS;

/** A saved hypothesis or description, as read rather than edited. */
export default function ExperimentTextValue({
  field,
  value,
  shareUid,
}: {
  field: ExperimentTextFieldKey;
  value: string;
  // Rendered on the experiment's public page.
  shareUid?: string;
}) {
  if (!value) {
    return (
      <Text weight="regular" color="text-mid" size="md" fontStyle="italic">
        No {field}
      </Text>
    );
  }
  const body = (
    <Markdown
      isPublic={!!shareUid}
      shareUid={shareUid}
      shareType={shareUid ? "experiment" : undefined}
    >
      {value}
    </Markdown>
  );
  // Clamped, so a long one doesn't push the rest of the page away.
  return field === "description" ? (
    <ExpandableBlock>{body}</ExpandableBlock>
  ) : (
    body
  );
}
