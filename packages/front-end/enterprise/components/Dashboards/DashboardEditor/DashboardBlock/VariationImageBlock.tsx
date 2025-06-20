import React from "react";
import { VariationImageBlockInterface } from "back-end/src/enterprise/validators/dashboard-block";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import VariationsTable from "@/components/Experiment/VariationsTable";
import { useExperiments } from "@/hooks/useExperiments";
import { BlockProps } from "./index";

export default function VariationImageBlock({
  variationIds,
  isEditing,
  setBlock,
  experimentId,
}: BlockProps<VariationImageBlockInterface>) {
  const { experimentsMap } = useExperiments();
  const experiment = experimentsMap.get(experimentId);
  if (!experiment) return null;
  const variationOptions = experiment.variations.map((v) => ({
    label: v.name,
    value: v.id,
  }));

  return (
    <div className="variation-image-block">
      {isEditing && (
        <div className="mb-3">
          <MultiSelectField
            value={variationIds}
            options={variationOptions}
            onChange={(values) => {
              setBlock({
                type: "variation-image",
                variationIds: values || [],
                experimentId: experimentId,
              });
            }}
            placeholder="Select variations to display..."
          />
        </div>
      )}
      <VariationsTable
        experiment={experiment}
        variationsList={variationIds}
        canEditExperiment={false}
        allowImages={true}
      />
    </div>
  );
}
