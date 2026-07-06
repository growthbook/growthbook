import { useMemo } from "react";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import {
  BlockComparison,
  CompletedExperimentsBlockFilters,
  calculateProductAnalyticsDateRange,
  resolveBlockComparison,
  resolveCompletedExperimentsFilters,
} from "shared/enterprise";
import { useExperiments } from "@/hooks/useExperiments";
import {
  filterCompletedExperiments,
  getPreviousWindow,
  Window,
} from "./completedExperimentsData";

/**
 * Shared data source for the "Completed Experiments" block family (Scaled
 * Impact, Win Percentage, Team Velocity). Resolves the block's stored date
 * range + project scoping and returns the org's finished (stopped) experiments
 * within it, matching the "Completed Experiments" section of the Executive
 * Report.
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

  const filtered = useMemo(
    () =>
      filterCompletedExperiments(experiments, { startDate, endDate, projects }),
    [experiments, projects, startDate, endDate],
  );

  return { experiments: filtered, loading, filters };
}

/**
 * Like useCompletedExperiments, but additionally resolves the previous-period
 * window (span-shift) and returns the completed experiments in it whenever the
 * block's comparison is enabled. Both windows are filtered from the same
 * fetched experiment list, so there's no extra query.
 */
export function useCompletedExperimentsComparison(
  block: CompletedExperimentsBlockFilters & { comparison?: BlockComparison },
): {
  current: ExperimentInterfaceStringDates[];
  previous: ExperimentInterfaceStringDates[];
  loading: boolean;
  window: Window & { projects: string[] };
  previousWindow: Window;
  comparisonEnabled: boolean;
} {
  const window = useMemo(
    () => resolveCompletedExperimentsFilters(block),
    [block],
  );
  const comparison = resolveBlockComparison(block);
  const comparisonEnabled = comparison !== null;
  // Use an explicit prior window when the user set one (Custom Date Range +
  // compare); otherwise derive it by span-shifting the current window.
  const previousWindow = useMemo(() => {
    const ptf = comparison?.previousTimeFrame;
    if (
      ptf &&
      ptf.predefined === "customDateRange" &&
      ptf.startDate &&
      ptf.endDate
    ) {
      return calculateProductAnalyticsDateRange(ptf);
    }
    return getPreviousWindow(window);
  }, [comparison, window]);

  const { experiments, loading } = useExperiments("", true, "standard");

  const current = useMemo(
    () => filterCompletedExperiments(experiments, window),
    [experiments, window],
  );
  const previous = useMemo(
    () =>
      comparisonEnabled
        ? filterCompletedExperiments(experiments, {
            ...previousWindow,
            projects: window.projects,
          })
        : [],
    [experiments, previousWindow, window.projects, comparisonEnabled],
  );

  return {
    current,
    previous,
    loading,
    window,
    previousWindow,
    comparisonEnabled,
  };
}
