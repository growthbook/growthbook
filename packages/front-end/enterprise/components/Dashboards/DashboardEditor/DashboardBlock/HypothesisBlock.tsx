import React from "react";
import { HypothesisBlockInterface } from "back-end/src/enterprise/validators/dashboard-block";
import { Blockquote } from "@radix-ui/themes";
import { useExperiments } from "@/hooks/useExperiments";
import { BlockProps } from ".";

export default function HypothesisBlock({
  block: { experimentId },
}: BlockProps<HypothesisBlockInterface>) {
  const { experimentsMap } = useExperiments();
  const experiment = experimentsMap.get(experimentId);
  if (!experiment) return null;
  return (
    <Blockquote>
      {!experiment.hypothesis ? (
        <span className="font-italic text-muted">
          Add a hypothesis statement to help focus the nature of your experiment
        </span>
      ) : (
        experiment.hypothesis
      )}
    </Blockquote>
  );
}
