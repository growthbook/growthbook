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
import { useExperimentSearch } from "@/services/experiments";
import {
  filterCompletedExperiments,
  getPreviousWindow,
  Window,
} from "./completedExperimentsData";

// localStorage key for the search hook's sort state. Sort output is unused here
// (we consume the pre-sort filtered list), so a single shared key is fine.
const SEARCH_STORAGE_KEY = "dashboard-completed-experiments";

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

  // Apply the block's saved "Filter Experiments" query (tags, owners, result,
  // etc.) using the same syntax filters as the experiment list. Empty string is
  // a no-op, so blocks without a saved filter behave as before.
  const { filteredItems } = useExperimentSearch({
    allExperiments: experiments,
    controlledSearchValue: block.experimentSearchString ?? "",
    localStorageKey: SEARCH_STORAGE_KEY,
  });

  const filtered = useMemo(
    () =>
      filterCompletedExperiments(filteredItems, {
        startDate,
        endDate,
        projects,
      }),
    [filteredItems, projects, startDate, endDate],
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

  // Apply the block's saved "Filter Experiments" query once; both the current
  // and previous windows are then sliced from the same search-filtered list.
  const { filteredItems } = useExperimentSearch({
    allExperiments: experiments,
    controlledSearchValue: block.experimentSearchString ?? "",
    localStorageKey: SEARCH_STORAGE_KEY,
  });

  const current = useMemo(
    () => filterCompletedExperiments(filteredItems, window),
    [filteredItems, window],
  );
  const previous = useMemo(
    () =>
      comparisonEnabled
        ? filterCompletedExperiments(filteredItems, {
            ...previousWindow,
            projects: window.projects,
          })
        : [],
    [filteredItems, previousWindow, window.projects, comparisonEnabled],
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
