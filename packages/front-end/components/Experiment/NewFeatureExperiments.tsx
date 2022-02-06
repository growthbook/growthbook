import React, { useState } from "react";
import useApi from "../../hooks/useApi";
import { ExperimentRule, FeatureInterface } from "back-end/types/feature";
import { useDefinitions } from "../../services/DefinitionsContext";
import NewExperimentForm from "./NewExperimentForm";
import { ago } from "../../services/dates";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";

export default function NewFeatureExperiments() {
  const { project, datasources } = useDefinitions();
  const [newExpModal, setNewExpModal] = useState(false);
  const [expDef, setExpDef] = useState(null);
  // get a list of all features that do not have an experiment report
  const { data, error } = useApi<{
    features: {
      feature: FeatureInterface;
      rule: ExperimentRule;
      trackingKey: string;
      partialExperiment: Partial<ExperimentInterfaceStringDates>;
    }[];
  }>(`/experiments/newfeatures/?project=${project || ""}`);

  if (!data || error || data?.features?.length === 0) {
    return null;
  }

  return (
    <div className="mb-3" style={{ maxHeight: "107px", overflowY: "auto" }}>
      {data.features.map((o, i) => {
        const f = o.feature;
        const expDefinition = o.partialExperiment;
        return (
          <div key={i} className="mb-2 alert alert-info py-2">
            <div className="d-flex align-items-center justify-content-between">
              <div>
                New experiment feature found:{" "}
                <strong>{expDefinition.trackingKey}</strong> (created{" "}
                {ago(f.dateCreated)})
              </div>
              {datasources?.length > 0 ? (
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
              ) : (
                <span>A data source is required before adding</span>
              )}
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
