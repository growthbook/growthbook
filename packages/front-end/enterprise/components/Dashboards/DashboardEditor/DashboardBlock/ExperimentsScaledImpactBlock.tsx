import { useState } from "react";
import { ExperimentsScaledImpactBlockInterface } from "shared/enterprise";
import { useUser } from "@/services/UserContext";
import ExecExperimentImpact from "@/enterprise/components/ExecReports/ExecExperimentImpact";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import LoadingSpinner from "@/components/LoadingSpinner";
import Callout from "@/ui/Callout";
import { useCompletedExperiments } from "./completedExperiments";
import { BlockProps } from ".";

export default function ExperimentsScaledImpactBlock({
  block,
}: BlockProps<ExperimentsScaledImpactBlockInterface>) {
  const { hasCommercialFeature } = useUser();
  // The impact table's won/lost/other filter is interactive (not persisted).
  const [experimentsToShow, setExperimentsToShow] = useState("all");

  const { experiments, loading, filters } = useCompletedExperiments(block);

  if (!hasCommercialFeature("experiment-impact")) {
    return (
      <Callout status="info">
        <PremiumTooltip commercialFeature="experiment-impact">
          Scaled Impact is available to Enterprise customers
        </PremiumTooltip>
      </Callout>
    );
  }

  if (!block.metricId) {
    return (
      <Callout status="info">
        Select a metric to display its scaled impact.
      </Callout>
    );
  }

  if (loading) return <LoadingSpinner />;

  return (
    <ExecExperimentImpact
      allExperiments={experiments}
      startDate={filters.startDate}
      endDate={filters.endDate}
      projects={filters.projects}
      metric={block.metricId}
      experimentsToShow={experimentsToShow}
      setExperimentsToShow={setExperimentsToShow}
      embedded
    />
  );
}
