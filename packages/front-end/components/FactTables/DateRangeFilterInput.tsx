import { format } from "date-fns";
import { getValidDateOffsetByUTC } from "shared/dates";
import DatePicker from "@/components/DatePicker";
import { useMergedUpdates } from "@/hooks/useMergedUpdates";

/**
 * Date-range value input for the `between` / `not_between` row-filter operators.
 *
 * The underlying DayPicker range calendar reports a completed range by calling
 * `setDate(from)` and `setDate2(to)` back-to-back in the same tick. Read
 * straight from the render closure, the second update would overwrite the first
 * and the new start date would be silently lost — which is what made changing
 * an existing range feel broken. `useMergedUpdates` composes the two same-tick
 * updates so both bounds stick.
 *
 * Bounds are stored as `yyyy-MM-dd` and read back via getValidDateOffsetByUTC
 * (the app-wide UTC wall-clock convention); getRowFilterSQL then compares them
 * as UTC midnight.
 */
export function DateRangeFilterInput({
  values,
  onChange,
  inputWidth,
}: {
  values: string[] | undefined;
  onChange: (values: string[]) => void;
  inputWidth?: number;
}) {
  const applyUpdate = useMergedUpdates<string[]>(values ?? [], onChange);

  const applyBound = (index: 0 | 1, d: Date | undefined) => {
    applyUpdate((current) => {
      const next = [...current];
      next[index] = d ? format(d, "yyyy-MM-dd") : "";
      return next;
    });
  };

  // Read from the `yyyy-MM-dd` prefix so a value that still carries a time
  // component (e.g. switched over from a `>` filter before it was reshaped)
  // lands on the right calendar day instead of being shifted by the tz offset.
  const parseBound = (v: string | undefined) =>
    v ? getValidDateOffsetByUTC(v.slice(0, 10)) : undefined;

  return (
    <DatePicker
      date={parseBound(values?.[0])}
      setDate={(d) => applyBound(0, d)}
      date2={parseBound(values?.[1])}
      setDate2={(d) => applyBound(1, d)}
      precision="date"
      inputWidth={inputWidth}
      compact
    />
  );
}
