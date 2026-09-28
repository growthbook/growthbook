import { useCallback, useRef, useState } from "react";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { useAuth } from "@/services/auth";
import { nextManualChecklist } from "./checklistSummary";

// The PUT replaces the whole list, so one write at a time: a second toggle
// before the refresh would drop the first.
export function useManualChecklistToggle(
  experiment: ExperimentInterfaceStringDates,
  mutate: () => unknown | Promise<unknown>,
) {
  const { apiCall } = useAuth();
  const inFlight = useRef(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = useCallback(
    async (manualKey: string, checked: boolean) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setError(null);
      try {
        await apiCall(`/experiment/${experiment.id}/launch-checklist`, {
          method: "PUT",
          body: JSON.stringify({
            checklist: nextManualChecklist(
              experiment.manualLaunchChecklist,
              manualKey,
              checked,
            ),
          }),
        });
        await mutate();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        inFlight.current = false;
      }
    },
    [apiCall, experiment.id, experiment.manualLaunchChecklist, mutate],
  );

  return { toggle, error };
}
