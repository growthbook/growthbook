import Checkbox from "@/ui/Checkbox";
import Text from "@/ui/Text";

const COPY = {
  retention: {
    label: "Exclude in-progress conversions",
    description:
      "Only include units exposed long enough ago to reach the end of their retention period. For retention metrics with no end date, include units exposed long enough ago to reach the start of their retention period.",
  },
  other: {
    label: "Exclude in-progress conversions",
    description:
      "Only include units exposed long enough ago to complete the entire conversion window.",
  },
};

// Metric-level counterpart of the experiment's "Exclude in-progress
// conversions" setting. Render it next to the window that bounds a unit's time
// to convert, and only when skipPartialDataOk says there is one.
export default function SkipPartialDataCheckbox({
  value,
  setValue,
  retention,
  readOnly = false,
}: {
  value: boolean;
  setValue: (value: boolean) => void;
  retention: boolean;
  readOnly?: boolean;
}) {
  const { label, description } = retention ? COPY.retention : COPY.other;
  return (
    <Checkbox
      // Styled like the Switch labels this sits beside
      label={
        <Text weight="medium" color="text-high">
          {label}
        </Text>
      }
      description={description}
      value={value}
      setValue={setValue}
      readOnly={readOnly}
    />
  );
}
