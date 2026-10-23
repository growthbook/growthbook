import { Select, SelectItem, SelectSize } from "@/ui/Select";
import { getMetricPreviewUnitLabel } from "@/components/FactTables/MetricEditor/metricPreview";
import styles from "./PreviewUnitSelect.module.scss";

type UnitLabelFactTable = Parameters<typeof getMetricPreviewUnitLabel>[1];

// Picks the identifier a preview counts by. Options show the unit's display
// name over its column; the trigger shows the name only.
export default function PreviewUnitSelect({
  units,
  value,
  setValue,
  factTable,
  size = "sm",
  "aria-label": ariaLabel = "Unit",
}: {
  units: string[];
  value: string | null;
  setValue: (unit: string) => void;
  /** Resolves display names and columns for the units. */
  factTable: UnitLabelFactTable;
  size?: SelectSize;
  "aria-label"?: string;
}) {
  return (
    <Select
      size={size}
      triggerClassName={styles.trigger}
      aria-label={ariaLabel}
      value={value ?? ""}
      setValue={setValue}
    >
      {units.map((id) => {
        const { label, column } = getMetricPreviewUnitLabel(id, factTable);
        return (
          <SelectItem
            key={id}
            value={id}
            textValue={label}
            className={styles.item}
          >
            <span className={styles.option}>
              <span>{label}</span>
              <span className={styles.descriptor}>{column}</span>
            </span>
          </SelectItem>
        );
      })}
    </Select>
  );
}
