import type { ExplorationDateRange } from "shared/validators";
import { useMergedUpdates } from "@/hooks/useMergedUpdates";

export function useMergedDateRangeUpdates(
  value: ExplorationDateRange | null,
  onChange: (dateRange: ExplorationDateRange) => void,
) {
  const applyUpdate = useMergedUpdates<ExplorationDateRange | null>(
    value,
    (next) => {
      if (next) onChange(next);
    },
  );

  return (updates: Partial<ExplorationDateRange>) => {
    applyUpdate((current) => {
      // Only merge into an active custom range; otherwise abort (no onChange).
      if (current?.predefined !== "customDateRange") return undefined;
      return { ...current, ...updates };
    });
  };
}
