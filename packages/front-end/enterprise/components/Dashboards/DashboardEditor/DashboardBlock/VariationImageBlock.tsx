import React from "react";
import { VariationImageBlockInterface } from "back-end/src/enterprise/validators/dashboard-block";
import VariationsTable from "@/components/Experiment/VariationsTable";
import { BlockProps } from "./index";

export default function VariationImageBlock({
  block: { variationIds },
  experiment,
}: BlockProps<VariationImageBlockInterface>) {
  const variationsList =
    variationIds.length === 0
      ? experiment.variations.map(({ id }) => id)
      : variationIds;

  return (
    <div className="variation-image-block">
      <VariationsTable
        experiment={experiment}
        variationsList={variationsList}
        canEditExperiment={false}
        allowImages={true}
      />
    </div>
  );
}
