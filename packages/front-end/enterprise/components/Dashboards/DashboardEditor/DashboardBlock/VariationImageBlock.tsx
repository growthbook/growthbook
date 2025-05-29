import React from "react";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import VariationsTable from "@/components/Experiment/VariationsTable";
import { Block } from "./index";

export default function VariationImageBlock({
  variationIds,
  isEditing,
  setBlock,
  experiment,
}: {
  variationIds: string[];
  isEditing: boolean;
  setBlock: (block: Block) => void;
  experiment: ExperimentInterfaceStringDates;
}) {
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
