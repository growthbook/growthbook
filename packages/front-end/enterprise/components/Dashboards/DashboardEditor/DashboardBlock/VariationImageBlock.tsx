import React from "react";
import { VariationImageBlockInterface } from "back-end/src/enterprise/validators/dashboard-block";
import VariationsTable from "@/components/Experiment/VariationsTable";
import { useExperiments } from "@/hooks/useExperiments";
import { BlockProps } from "./index";

export default function VariationImageBlock({
  block: { variationIds, experimentId },
}: BlockProps<VariationImageBlockInterface>) {
  const { experimentsMap } = useExperiments();
  const experiment = experimentsMap.get(experimentId);
  if (!experiment) return null;

  return (
    <div className="variation-image-block">
      <VariationsTable
        experiment={experiment}
        variationsList={variationIds}
        canEditExperiment={false}
        allowImages={true}
      />
    </div>
  );
}
