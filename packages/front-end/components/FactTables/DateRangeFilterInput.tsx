import { format } from "date-fns";
import DatePicker from "@/components/DatePicker";
import { useMergedUpdates } from "@/hooks/useMergedUpdates";
import { parseRowFilterDateValue } from "./rowFilterUtils";

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
 * Bounds are stored as `yyyy-MM-dd` UTC wall-clock (the app-wide convention for
 * date fields that reach a warehouse query); getRowFilterSQL then compares them
 * as UTC calendar days.
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
    parseRowFilterDateValue(v, true);

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
