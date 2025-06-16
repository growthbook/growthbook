import React from "react";
import { MetadataBlockInterface } from "back-end/src/enterprise/validators/dashboard-block";
import SelectField from "@/components/Forms/SelectField";
import ExperimentHypothesis from "@/components/Experiment/TabbedPage/ExperimentHypothesis";
import ExperimentDescription from "@/components/Experiment/TabbedPage/ExperimentDescription";
import { BlockProps, withExperiment } from ".";

export default function MetadataBlock({
  subtype,
  isEditing,
  setBlock,
  experiment,
  mutate,
}: withExperiment<BlockProps<MetadataBlockInterface>>) {
  return (
    <>
      {isEditing && (
        <SelectField
          label="Choose a block to show"
          value={subtype}
          options={[
            { label: "description", value: "description" },
            { label: "hypothesis", value: "hypothesis" },
          ]}
          onChange={(value) =>
            setBlock({
              type: "metadata",
              subtype: value as "description" | "hypothesis",
              experimentId: experiment.id,
            })
          }
        />
      )}
      <div className="metadata-block">
        {subtype === "description" ? (
          <p>
            {
              <ExperimentDescription
                experiment={experiment}
                canEditExperiment={false}
                mutate={mutate}
              />
            }
          </p>
        ) : (
          <p>
            {
              <ExperimentHypothesis
                experiment={experiment}
                canEditExperiment={false}
                mutate={mutate}
              />
            }
          </p>
        )}
      </div>
    </>
  );
}
