import { format } from "date-fns";
import DatePicker from "@/components/DatePicker";
import { isDateOnlyOperator, parseRowFilterDateValue } from "./rowFilterUtils";

/**
 * Single-value date input for the `= < <= > >=` row-filter operators.
 *
 * Equality on a date means "on this calendar day", so `=` uses a date-only
 * picker — selecting a time-of-day for an exact match is meaningless. The
 * ordering operators are cutoffs where a specific time can matter, so they use
 * the minute-level datetime picker (picking a day defaults to 00:00).
 *
 * Values are stored as `yyyy-MM-dd` (equality) or `yyyy-MM-dd'T'HH:mm`
 * (ordering) and are UTC wall-clock: what the field shows is what
 * `getRowFilterSQL` compares against, with no browser-timezone conversion in
 * either direction. `parseRowFilterDateValue` handles reading a value back
 * whichever accepted spelling it is stored in — the operator can be switched
 * without re-picking a date, and API callers can send an instant with a
 * trailing `Z`.
 */
export function DateFilterInput({
  value,
  operator,
  onChange,
  inputWidth,
}: {
  value: string | undefined;
  operator: string;
  onChange: (values: string[]) => void;
  inputWidth?: number;
}) {
  const dateOnly = isDateOnlyOperator(operator);
  const dateFormat = dateOnly ? "yyyy-MM-dd" : "yyyy-MM-dd'T'HH:mm";

  return (
    <DatePicker
      date={parseRowFilterDateValue(value, dateOnly)}
      setDate={(d) => onChange(d ? [format(d, dateFormat)] : [])}
      precision={dateOnly ? "date" : "datetime"}
      inputWidth={inputWidth}
      compact
    />
  );
}
