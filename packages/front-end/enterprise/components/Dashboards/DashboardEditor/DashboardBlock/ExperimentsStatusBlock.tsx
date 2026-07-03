import { useMemo } from "react";
import {
  ExperimentsStatusBlockInterface,
  resolveCompletedExperimentsFilters,
} from "shared/enterprise";
import ExecExperimentsGraph from "@/components/ExecReports/ExecExperimentsGraph";
import LoadingSpinner from "@/components/LoadingSpinner";
import { useCompletedExperiments } from "./completedExperiments";
import { BlockProps } from ".";

export default function ExperimentsStatusBlock({
  block,
}: BlockProps<ExperimentsStatusBlockInterface>) {
  const filters = useMemo(
    () => resolveCompletedExperimentsFilters(block),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [block.dateRange, block.startDate, block.endDate, block.projects],
  );
  const { experiments, loading } = useCompletedExperiments(filters);

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
