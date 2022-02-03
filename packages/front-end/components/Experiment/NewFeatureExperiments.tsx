import React, { useState } from "react";
import useApi from "../../hooks/useApi";
import { FeatureInterface } from "back-end/types/feature";
import { useDefinitions } from "../../services/DefinitionsContext";
import { getExperimentDefinitionFromFeature } from "../../services/features";
import NewExperimentForm from "./NewExperimentForm";
import { ago } from "../../services/dates";

export default function NewFeatureExperiments() {
  const { project } = useDefinitions();
  const [newExpModal, setNewExpModal] = useState(false);
  const [expDef, setExpDef] = useState(null);
  // get a list of all features that do not have an experiment report
  const { data, error } = useApi<{
    features: FeatureInterface[];
  }>(`/experiments/newfeatures/?project=${project || ""}`);

  if (!data || error || data?.features.length === 0) {
    return null;
  }

  return (
    <div className="mb-3" style={{ maxHeight: "120px", overflowY: "auto" }}>
      {data.features.map((f, i) => {
        const expDefinition = getExperimentDefinitionFromFeature(f);
        return (
          <div key={i} className="mb-2 alert alert-info py-2">
            <div className="d-flex align-items-center justify-content-between">
              <div>
                New experiment feature found:{" "}
                <strong>{expDefinition.trackingKey}</strong> (created{" "}
                {ago(f.dateCreated)})
              </div>
              <a
                className="btn btn-info btn-sm"
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  setExpDef(expDefinition);
                  setNewExpModal(true);
                }}
              >
                Add experiment report
              </a>
            </div>
          </div>
        );
      })}
      {newExpModal && (
        <NewExperimentForm
          onClose={() => setNewExpModal(false)}
          source="feature-rule"
          isImport={true}
          msg="We've prefilled the form with values from the the feature."
          initialValue={expDef}
        />
      )}
    </div>
  );
}
