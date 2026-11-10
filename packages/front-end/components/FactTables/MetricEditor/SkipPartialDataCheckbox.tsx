import Checkbox from "@/ui/Checkbox";

// Metric-level counterpart of the experiment's "Exclude in-progress
// conversions" setting. Render it next to the window that bounds a unit's time
// to convert, and only when skipPartialDataOk says there is one.
export default function SkipPartialDataCheckbox({
  value,
  setValue,
  readOnly = false,
}: {
  value: boolean;
  setValue: (value: boolean) => void;
  readOnly?: boolean;
}) {
  return (
    <Checkbox
      label="Exclude in-progress conversions"
      description="Only analyze users exposed long enough ago to have had the full time to convert. Otherwise, recently exposed users count as not converted."
      value={value}
      setValue={setValue}
      readOnly={readOnly}
    />
  );
}
