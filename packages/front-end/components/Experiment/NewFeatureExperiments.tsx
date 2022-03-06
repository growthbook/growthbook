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
  const [
    expDef,
    setExpDef,
  ] = useState<null | Partial<ExperimentInterfaceStringDates>>(null);
  // get a list of all features that do not have an experiment report
  const { data, error } = useApi<{
    features: {
      feature: FeatureInterface;
      rule: ExperimentRule;
      trackingKey: string;
      partialExperiment: Partial<ExperimentInterfaceStringDates>;
    }[];
  }>(`/experiments/newfeatures/?project=${project || ""}`);

  if (!data || error || !data?.features?.length || !datasources.length) {
    return null;
  }

  const { feature, partialExperiment } = data.features[0];

  return (
    <div className="mb-3">
      <div className="mb-2 alert alert-info py-2">
        <div className="d-flex align-items-center justify-content-between">
          <div>
            New feature experiment found:{" "}
            <strong>{partialExperiment.trackingKey}</strong> (created{" "}
            {ago(feature.dateCreated)})
          </div>
          <a
            className="btn btn-info btn-sm"
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setExpDef(partialExperiment);
              setNewExpModal(true);
            }}
          >
            Start Analysis
          </a>
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
