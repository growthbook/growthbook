import { useEffect, useRef } from "react";
import type { ExplorationDateRange } from "shared/validators";

export function useMergedDateRangeUpdates(
  value: ExplorationDateRange | null,
  onChange: (dateRange: ExplorationDateRange) => void,
) {
  const latestValueRef = useRef(value);

  useEffect(() => {
    latestValueRef.current = value;
  }, [value]);

  return (updates: Partial<ExplorationDateRange>) => {
    const currentValue = latestValueRef.current;
    if (currentValue?.predefined !== "customDateRange") return;

    const nextValue = {
      ...currentValue,
      ...updates,
    };
    latestValueRef.current = nextValue;
    onChange(nextValue);
  };
}
