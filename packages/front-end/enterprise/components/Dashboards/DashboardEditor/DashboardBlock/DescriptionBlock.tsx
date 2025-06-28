import React from "react";
import { DescriptionBlockInterface } from "back-end/src/enterprise/validators/dashboard-block";
import ExperimentDescription from "@/components/Experiment/TabbedPage/ExperimentDescription";
import { useExperiments } from "@/hooks/useExperiments";
import { BlockProps } from ".";

export default function DescriptionBlock({
  block: { experimentId },
  mutate,
}: BlockProps<DescriptionBlockInterface>) {
  const { experimentsMap } = useExperiments();
  const experiment = experimentsMap.get(experimentId);
  if (!experiment) return null;
  return (
    <ExperimentDescription
      experiment={experiment}
      canEditExperiment={false}
      mutate={mutate}
    />
  );
}
