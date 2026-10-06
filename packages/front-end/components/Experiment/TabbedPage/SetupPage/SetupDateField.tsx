import { ComponentProps } from "react";
import { PiCalendarBlank } from "react-icons/pi";
import DatePicker from "@/components/DatePicker";
import planStyles from "./AnalysisPlan.module.scss";
import styles from "./SetupDateField.module.scss";

// The Setup page's date field, as the Analysis Plan's Timing uses it, shared
// so the Edit Schedule modal uses the same one (set in review): 32px tall
// (compact), 208px wide, "mm/dd/yyyy" while empty and a calendar icon on the
// right, with the placeholder and icon colours in .dateField, and the page's
// hover outline. fullWidth fills the row instead of 208px; size "medium" is
// one step up, 38px (DatePicker's standard height) instead of 32px. Both
// optional, set in review for the Edit Schedule modal.
export const SETUP_DATE_FIELD_PX = 208;

export default function SetupDateField({
  date,
  setDate,
  disableBefore,
  fullWidth = false,
  size = "small",
}: {
  date: string | undefined;
  setDate: (d: Date | null) => void;
  disableBefore?: ComponentProps<typeof DatePicker>["disableBefore"];
  fullWidth?: boolean;
  size?: "small" | "medium";
}) {
  return (
    <div
      className={`${styles.field}${fullWidth ? ` ${styles.fullWidth}` : ""}`}
    >
      <DatePicker
        containerClassName={planStyles.dateField}
        label=""
        compact={size === "small"}
        emptyPlaceholder="mm/dd/yyyy"
        endIcon={<PiCalendarBlank size="14" />}
        inputWidth={fullWidth ? undefined : SETUP_DATE_FIELD_PX}
        date={date}
        disableBefore={disableBefore}
        setDate={(d) => setDate(d ?? null)}
      />
    </div>
  );
}
