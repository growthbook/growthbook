import { ExperimentsWinRateBlockInterface } from "shared/enterprise";
import ExperimentWinRate from "@/components/ExecReports/ExperimentWinRate";
import LoadingSpinner from "@/components/LoadingSpinner";
import { useCompletedExperiments } from "./completedExperiments";
import { BlockProps } from ".";

export default function ExperimentsWinRateBlock({
  block,
}: BlockProps<ExperimentsWinRateBlockInterface>) {
  const { experiments, loading, filters } = useCompletedExperiments(block);

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
