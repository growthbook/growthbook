import { useMemo } from "react";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { useExperiments } from "@/hooks/useExperiments";

/**
 * Shared data source for the "Completed Experiments" block family (Scaled
 * Impact, Win Percentage, Experiment Status). Returns the org's finished
 * (stopped) experiments scoped to the given date range and projects, matching
 * the "Completed Experiments" section of the Executive Report.
 */
export function useCompletedExperiments({
  startDate,
  endDate,
  projects,
}: {
  startDate: Date;
  endDate: Date;
  projects: string[];
}): { experiments: ExperimentInterfaceStringDates[]; loading: boolean } {
  const { experiments, loading } = useExperiments("", true, "standard");

  const filtered = useMemo(() => {
    return experiments
      .filter((e) => e.type !== "multi-armed-bandit")
      .filter((e) => e.status === "stopped")
      .filter(
        (e) =>
          projects.length === 0 ||
          (e.project ? projects.includes(e.project) : false),
      )
      .filter((e) =>
        e.phases.some((p) => {
          if (!p.dateEnded) return false;
          const ended = new Date(p.dateEnded);
          return ended >= startDate && ended <= endDate;
        }),
      );
  }, [experiments, projects, startDate, endDate]);

  return { experiments: filtered, loading };
}
