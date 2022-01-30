import { FC, useEffect, useState } from "react";
import NewExperimentForm from "./NewExperimentForm";
import {
  ExperimentInterfaceStringDates,
  ExperimentPhaseStringDates,
} from "back-end/types/experiment";
import { ExperimentValue, FeatureInterface } from "back-end/types/feature";
import useApi from "../../hooks/useApi";
import { useRouter } from "next/router";
import LoadingOverlay from "../LoadingOverlay";
import { operatorToText } from "../Features/ConditionDisplay";
import { jsonToConds, useAttributeMap } from "../../services/features";

const NewExperimentFromFeature: FC<{
  featureId?: string;
  source?: string;
  onClose?: () => void;
  onCreate?: (string) => void;
}> = ({ featureId, source, onClose, onCreate }) => {
  const [
    selected,
    setSelected,
  ] = useState<null | Partial<ExperimentInterfaceStringDates>>(null);
  //const [importModal, setImportModal] = useState<boolean>(false);
  const router = useRouter();
  const { data, error } = useApi<{
    feature: FeatureInterface;
    experiments: { [key: string]: ExperimentInterfaceStringDates };
  }>(`/feature/${featureId}`);

  // this has hooks and has to be outside the useEffects.
  const attributes = useAttributeMap();

  useEffect(() => {
    if (data?.feature && Object.keys(data?.experiments).length === 0) {
      let expRule = null;
      data.feature.rules.forEach((r) => {
        if (r.type === "experiment") {
          expRule = r;
        }
      });
      if (!expRule) return;
      const expInfo: Partial<ExperimentInterfaceStringDates> = {};
      expInfo.name = data.feature.id + " experiment";
      expInfo.hypothesis = data.feature?.description;
      expInfo.project = data.feature?.project;
      expInfo.trackingKey = expRule.trackingKey;
      expInfo.status = "running";

      // create the description based on the targeting conditions if any:
      if (expRule.condition && expRule.condition != "{}") {
        const conds = jsonToConds(expRule.condition);
        const conditionsStrArr = [];
        if (conds !== null && attributes.size) {
          conds.forEach(({ field, operator, value }) => {
            let condStr =
              field + " " + operatorToText(operator, attributes[field]);
            if (!["$exists", "$notExists"].includes(operator)) {
              if (operator === "$true") condStr += " true";
              else if (operator === "$false") condStr += " false";
              else condStr += " " + value;
            }
            conditionsStrArr.push(condStr);
          });
          expInfo.description =
            "Experiment shown to users where " + conditionsStrArr.join(" and ");
        }
      }
      const variationWeights: number[] = [];
      expInfo.variations = expRule.values.map((e: ExperimentValue, i) => {
        variationWeights.push(e.weight);
        let name = i ? `Variation ${i}` : "Control";
        if (data?.feature?.valueType === "boolean") {
          if (e.value === "true") {
            name = "On";
          } else {
            name = "Off";
          }
        }
        if (data?.feature?.valueType === "number" && e.value !== i) {
          name += " (" + e.value + ")";
        }

        return {
          name,
          description: "",
          key: "",
          screenshots: [],
        };
      });
      const phase: ExperimentPhaseStringDates = {
        dateStarted: new Date().toISOString().substr(0, 16),
        phase: "main",
        reason: "",
        coverage: 1,
        variationWeights,
      };
      expInfo.phases = [phase];

      setSelected(expInfo);
    }
  }, [data?.feature]);

  if (error) {
    return (
      <div className="alert alert-danger">
        An error occurred: {error.message}
      </div>
    );
  }
  if (!data) {
    return <LoadingOverlay />;
  }
  if (Object.keys(data?.experiments).length > 0) {
    // an experiment exists already with this tracking key. Redirect to that page:
    router.push(
      `/experiment/${data.experiments[Object.keys(data?.experiments)[0]].id}`
    );
    return null;
  }
  if (selected) {
    return (
      <NewExperimentForm
        initialValue={selected}
        onClose={() => onClose()}
        onCreate={(eid) => onCreate(eid)}
        source={source}
        isImport={false}
        isFromFeature={true}
        msg={
          "No experiment exists yet for this feature flag. Complete this pre-filled form to create the experiment."
        }
      />
    );
  }
  return null;
};
export default NewExperimentFromFeature;
