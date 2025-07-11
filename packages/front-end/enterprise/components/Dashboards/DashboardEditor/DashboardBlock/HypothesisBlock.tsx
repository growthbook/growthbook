import React from "react";
import { HypothesisBlockInterface } from "back-end/src/enterprise/validators/dashboard-block";
import { Box } from "@radix-ui/themes";
import { useExperiments } from "@/hooks/useExperiments";
import { BlockProps } from ".";

export default function HypothesisBlock({
  block: { experimentId },
}: BlockProps<HypothesisBlockInterface>) {
  const { experimentsMap } = useExperiments();
  const experiment = experimentsMap.get(experimentId);
  if (!experiment) return null;
  return (
    <>
      {experiment.hypothesis ? (
        <Box as="div" py="2">
          {experiment.hypothesis}
        </Box>
      ) : (
        <Box as="div" className="font-italic text-muted" py="2">
          This experiment doesn&apos;t have a hypothesis yet.
        </Box>
      )}
    </>
  );
}
