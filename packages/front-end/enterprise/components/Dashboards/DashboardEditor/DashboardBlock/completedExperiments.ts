import { useMemo } from "react";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import {
  CompletedExperimentsBlockFilters,
  resolveCompletedExperimentsFilters,
} from "shared/enterprise";
import { useExperiments } from "@/hooks/useExperiments";

/**
 * Shared data source for the "Completed Experiments" block family (Scaled
 * Impact, Win Percentage, Experiment Status). Resolves the block's stored
 * date range + project scoping and returns the org's finished (stopped)
 * experiments within it, matching the "Completed Experiments" section of the
 * Executive Report.
 */
export function useCompletedExperiments(
  block: CompletedExperimentsBlockFilters,
): {
  experiments: ExperimentInterfaceStringDates[];
  loading: boolean;
  filters: { startDate: Date; endDate: Date; projects: string[] };
} {
  const filters = useMemo(
    () => resolveCompletedExperimentsFilters(block),
    [block],
  );
  const { startDate, endDate, projects } = filters;
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

  return { experiments: filtered, loading, filters };
}
