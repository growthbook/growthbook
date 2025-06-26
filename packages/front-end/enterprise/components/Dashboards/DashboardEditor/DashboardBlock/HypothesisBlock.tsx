import React from "react";
import { HypothesisBlockInterface } from "back-end/src/enterprise/validators/dashboard-block";
import ExperimentHypothesis from "@/components/Experiment/TabbedPage/ExperimentHypothesis";
import { useExperiments } from "@/hooks/useExperiments";
import { BlockProps } from ".";

export default function HypothesisBlock({
  block: { experimentId },
  mutate,
}: BlockProps<HypothesisBlockInterface>) {
  const { experimentsMap } = useExperiments();
  const experiment = experimentsMap.get(experimentId);
  if (!experiment) return null;
  return (
    <>
      <div className="metadata-block">
        <p>
          {
            <ExperimentHypothesis
              experiment={experiment}
              canEditExperiment={false}
              mutate={mutate}
            />
          }
        </p>
      </div>
    </>
  );
}
