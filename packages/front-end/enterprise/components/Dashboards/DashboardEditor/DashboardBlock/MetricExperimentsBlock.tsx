import { MetricExperimentsBlockInterface } from "shared/enterprise";
import { ExperimentWithSnapshot } from "shared/types/experiment-snapshot";
import useApi from "@/hooks/useApi";
import { useDefinitions } from "@/services/DefinitionsContext";
import MetricExperiments from "@/components/MetricExperiments/MetricExperiments";
import LoadingSpinner from "@/components/LoadingSpinner";
import Callout from "@/ui/Callout";
import { BlockProps } from ".";

export default function MetricExperimentsBlock({
  block,
}: BlockProps<MetricExperimentsBlockInterface>) {
  const { getExperimentMetricById } = useDefinitions();
  const metric = getExperimentMetricById(block.metricId);

  const params = new URLSearchParams();
  if (block.experimentSearchString) {
    params.set("q", block.experimentSearchString);
  }
  params.set("bandits", block.bandits ? "true" : "false");
  if (block.startDate) params.set("startDate", block.startDate);
  if (block.endDate) params.set("endDate", block.endDate);
  const queryString = params.toString();

  const { data, isLoading } = useApi<{
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

  return (
    <MetricExperiments
      metric={metric}
      dataWithSnapshot={data?.data ?? []}
      bandits={block.bandits}
      differenceType={block.differenceType}
      outerClassName=""
    />
  );
}
