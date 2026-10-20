import {
  MetricExperimentsBlockInterface,
  calculateProductAnalyticsDateRange,
  getEffectiveExperimentBlock,
} from "shared/enterprise";
import { ExperimentWithSnapshot } from "shared/types/experiment-snapshot";
import { useMemo } from "react";
import useApi from "@/hooks/useApi";
import { useDefinitions } from "@/services/DefinitionsContext";
import MetricExperiments from "@/components/MetricExperiments/MetricExperiments";
import LoadingSpinner from "@/components/LoadingSpinner";
import Callout from "@/ui/Callout";
import { BlockProps } from ".";

export default function MetricExperimentsBlock({
  block: rawBlock,
  dashboardGlobalControls,
}: BlockProps<MetricExperimentsBlockInterface>) {
  const { getExperimentMetricById } = useDefinitions();
  // Apply any dashboard-wide global filters (metric / projects / experiment
  // search) the block has opted into. Date range is intentionally not applied to
  // this block — it keeps its own start/end phase-date windows.
  const block = getEffectiveExperimentBlock(rawBlock, {
    globalControls: dashboardGlobalControls,
  });
  const metric = getExperimentMetricById(block.metricId);

  // Memoize the query string. `calculateProductAnalyticsDateRange` resolves
  // rolling presets against `new Date()`, so rebuilding it every render would
  // produce a new (millisecond-different) URL each time — that thrashes the
  // useApi/SWR cache key and refetches in a loop that never settles. Recompute
  // only when the inputs that actually affect the query change.
  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (block.experimentSearchString) {
      params.set("q", block.experimentSearchString);
    }
    if (block.projects.length > 0) {
      params.set("projects", block.projects.join(","));
    }
    params.set("bandits", block.bandits ? "true" : "false");
    // End-date window filters on the experiment's phase end date.
    if (block.endDateRange) {
      const { startDate, endDate } = calculateProductAnalyticsDateRange(
        block.endDateRange,
      );
      params.set("startDate", startDate.toISOString());
      params.set("endDate", endDate.toISOString());
    }
    // Start-date window filters on the phase start date (includes running
    // experiments).
    if (block.startDateRange) {
      const { startDate, endDate } = calculateProductAnalyticsDateRange(
        block.startDateRange,
      );
      params.set("startedAfter", startDate.toISOString());
      params.set("startedBefore", endDate.toISOString());
    }
    return params.toString();
  }, [
    block.experimentSearchString,
    block.projects,
    block.bandits,
    block.startDateRange,
    block.endDateRange,
  ]);

  const { data, error, isLoading } = useApi<{
    data: ExperimentWithSnapshot[];
  }>(
    `/metrics/${block.metricId}/experiments${
      queryString ? `?${queryString}` : ""
    }`,
    {
      shouldRun: () => !!block.metricId,
    },
  );

  if (!block.metricId || !metric) {
    return (
      <Callout status="info">
        Select a metric to display its experiments.
      </Callout>
    );
  }

  if (isLoading) {
    return <LoadingSpinner />;
  }

  if (error) {
    return (
      <Callout status="error">
        Failed to load experiments for this metric: {error.message}
      </Callout>
    );
  }

  return (
    <MetricExperiments
      metric={metric}
      dataWithSnapshot={data?.data ?? []}
      bandits={block.bandits}
      differenceType={block.differenceType}
      columns={block.columns}
      outerClassName=""
    />
  );
}
