import { ExperimentsStatusBlockInterface } from "shared/enterprise";
import ExecExperimentsGraph from "@/components/ExecReports/ExecExperimentsGraph";
import LoadingSpinner from "@/components/LoadingSpinner";
import { useCompletedExperiments } from "./completedExperiments";
import { BlockProps } from ".";

export default function ExperimentsStatusBlock({
  block,
}: BlockProps<ExperimentsStatusBlockInterface>) {
  const { experiments, loading, filters } = useCompletedExperiments(block);

  if (loading) return <LoadingSpinner />;

  return (
    <ExecExperimentsGraph
      experiments={experiments}
      dateRange={block.dateRange}
      startDate={filters.startDate}
      endDate={filters.endDate}
      selectedProjects={filters.projects}
    />
  );
}
