import { useEffect, useRef } from "react";
import { format } from "date-fns";
import { getValidDateOffsetByUTC } from "shared/dates";
import DatePicker from "@/components/DatePicker";

/**
 * Date-range value input for the `between` / `not_between` row-filter operators.
 *
 * The underlying DayPicker range calendar reports a completed range by calling
 * `setDate(from)` and `setDate2(to)` back-to-back in the same tick. If both
 * callbacks read the filter's `values` straight from the render closure, the
 * second update overwrites the first and the new start date is silently lost —
 * which is what made changing an existing range feel broken. We funnel both
 * bounds through a ref that is updated synchronously so consecutive updates
 * compose, mirroring `useMergedDateRangeUpdates` used by the Metric Explorer
 * range picker.
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
  const latestValuesRef = useRef<string[]>(values ?? []);
  useEffect(() => {
    latestValuesRef.current = values ?? [];
  }, [values]);

  const applyBound = (index: 0 | 1, d: Date | undefined) => {
    const next = [...latestValuesRef.current];
    next[index] = d ? format(d, "yyyy-MM-dd") : "";
    latestValuesRef.current = next;
    onChange(next);
  };

  return (
    <DatePicker
      date={values?.[0] ? getValidDateOffsetByUTC(values[0]) : undefined}
      setDate={(d) => applyBound(0, d)}
      date2={values?.[1] ? getValidDateOffsetByUTC(values[1]) : undefined}
      setDate2={(d) => applyBound(1, d)}
      precision="date"
      inputWidth={inputWidth}
      inputHeight={36}
    />
  );
}
