import { useEffect, useState } from "react";
import {
  ExperimentsScaledImpactBlockInterface,
  getEffectiveExperimentBlock,
} from "shared/enterprise";
import { useUser } from "@/services/UserContext";
import ExecExperimentImpact from "@/enterprise/components/ExecReports/ExecExperimentImpact";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import LoadingSpinner from "@/components/LoadingSpinner";
import Callout from "@/ui/Callout";
import track from "@/services/track";
import { useCompletedExperiments } from "./completedExperiments";
import { BlockProps } from ".";

export default function ExperimentsScaledImpactBlock({
  block: rawBlock,
  dashboardGlobalControls,
}: BlockProps<ExperimentsScaledImpactBlockInterface>) {
  const { hasCommercialFeature } = useUser();
  // The impact table's won/lost/other filter is interactive (not persisted).
  const [experimentsToShow, setExperimentsToShow] = useState("all");

  // Apply any dashboard-wide global filters the block has opted into.
  const block = getEffectiveExperimentBlock(rawBlock, {
    globalControls: dashboardGlobalControls,
  });
  const { experiments, loading, filters } = useCompletedExperiments(block);
  const hasExperimentImpact = hasCommercialFeature("experiment-impact");
  const unavailableState = !hasExperimentImpact
    ? "not_entitled"
    : !block.metricId
      ? "metric_required"
      : null;

  useEffect(() => {
    if (!unavailableState) return;
    track("Experiment Impact Availability Evaluated", {
      surface: "dashboard-block",
      entitled: hasExperimentImpact,
      state: unavailableState,
      ...(block.metricId ? { metricId: block.metricId } : {}),
      experimentCount: experiments.length,
    });
  }, [
    block.metricId,
    experiments.length,
    hasExperimentImpact,
    unavailableState,
  ]);

  if (!hasExperimentImpact) {
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
