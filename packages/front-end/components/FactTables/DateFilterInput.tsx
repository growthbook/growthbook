import { format } from "date-fns";
import { getValidDate, getValidDateOffsetByUTC } from "shared/dates";
import DatePicker from "@/components/DatePicker";
import { isDateOnlyOperator } from "./rowFilterUtils";

/**
 * Single-value date input for the `= < <= > >=` row-filter operators.
 *
 * Equality on a date means "on this calendar day", so `=` uses a date-only
 * picker — selecting a time-of-day for an exact match is meaningless. The
 * ordering operators are cutoffs where a specific time can matter, so they use
 * the minute-level datetime picker (picking a day defaults to 00:00).
 *
 * The parsing is defensive about which format the stored value is in, because
 * the operator can be switched without re-picking a date: we read from the
 * `yyyy-MM-dd` prefix for the date-only picker, and treat a bare date as
 * midnight for the datetime picker, so the calendar never lands on the wrong
 * day. Values are stored as `yyyy-MM-dd` (equality) or `yyyy-MM-dd'T'HH:mm`
 * (ordering) and compared as UTC by getRowFilterSQL.
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
  const parsedDate = value
    ? dateOnly
      ? getValidDateOffsetByUTC(value.slice(0, 10))
      : getValidDate(value.length > 10 ? value : `${value.slice(0, 10)}T00:00`)
    : undefined;

  return (
    <DatePicker
      date={parsedDate}
      setDate={(d) => onChange(d ? [format(d, dateFormat)] : [])}
      precision={dateOnly ? "date" : "datetime"}
      inputWidth={inputWidth}
      compact
    />
  );
}
