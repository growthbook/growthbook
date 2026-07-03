import { useMemo } from "react";
import {
  ExperimentsWinRateBlockInterface,
  resolveCompletedExperimentsFilters,
} from "shared/enterprise";
import ExperimentWinRate from "@/components/ExecReports/ExperimentWinRate";
import LoadingSpinner from "@/components/LoadingSpinner";
import { useCompletedExperiments } from "./completedExperiments";
import { BlockProps } from ".";

export default function ExperimentsWinRateBlock({
  block,
}: BlockProps<ExperimentsWinRateBlockInterface>) {
  const filters = useMemo(
    () => resolveCompletedExperimentsFilters(block),
    // Recompute only when the block's stored filters change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [block.dateRange, block.startDate, block.endDate, block.projects],
  );
  const { experiments, loading } = useCompletedExperiments(filters);

  if (loading) return <LoadingSpinner />;

  return (
    <ExperimentWinRate
      experiments={experiments}
      dateRange={block.dateRange}
      startDate={filters.startDate}
      endDate={filters.endDate}
      selectedProjects={filters.projects}
      showProjectWinRate={block.showProjectBreakdown}
    />
  );
}
