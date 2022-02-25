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
  const [expDef, setExpDef] = useState<Partial<ExperimentInterfaceStringDates>>(
    null
  );
  // get a list of all features that do not have an experiment report
  const { data, error } = useApi<{
    features: {
      feature: FeatureInterface;
      rule: ExperimentRule;
      trackingKey: string;
      partialExperiment: Partial<ExperimentInterfaceStringDates>;
    }[];
  }>(`/experiments/newfeatures/?project=${project || ""}`);

  if (!data || error || data?.features?.length === 0 || !datasources.length) {
    return null;
  }

  const { feature, partialExperiment } = data.features[0];

  return (
    <div className="mb-3" style={{ maxHeight: "107px", overflowY: "auto" }}>
      <div className="mb-2 alert alert-info py-2">
        <div className="d-flex align-items-center justify-content-between">
          <div>
            New experiment feature found:{" "}
            <strong>{partialExperiment.trackingKey}</strong> (created{" "}
            {ago(feature.dateCreated)})
          </div>
          {datasources?.length > 0 ? (
            <a
              className="btn btn-info btn-sm"
              href="#"
              onClick={(e) => {
                e.preventDefault();
                setExpDef(partialExperiment);
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
