import { useForm } from "react-hook-form";
import { FeatureInterface, FeaturePrerequisite } from "back-end/types/feature";
import { useEffect, useMemo } from "react";
import { isFeatureCyclic } from "shared/util";
import { FaExclamationTriangle, FaExternalLinkAlt } from "react-icons/fa";
import clsx from "clsx";
import cloneDeep from "lodash/cloneDeep";
import { FeatureRevisionInterface } from "back-end/types/feature-revision";
import {
  getFeatureDefaultValue,
  useEnvironments,
  useFeaturesList,
  getPrerequisites,
  getDefaultPrerequisiteCondition,
} from "@/services/features";
import track from "@/services/track";
import { useIncrementer } from "@/hooks/useIncrementer";
import ValueDisplay from "@/components/Features/ValueDisplay";
import { useAuth } from "@/services/auth";
import PrerequisiteInput from "@/components/Features/PrerequisiteInput";
import Modal from "../Modal";
import SelectField from "../Forms/SelectField";

export interface Props {
  close: () => void;
  feature: FeatureInterface;
  mutate: () => void;
  i: number;
  revisions: FeatureRevisionInterface[];
  version: number;
}

export default function PrerequisiteModal({
  close,
  feature,
  i,
  mutate,
  revisions,
  version,
}: Props) {
  const { features } = useFeaturesList();
  const prerequisites = getPrerequisites(feature);
  const prerequisite = prerequisites[i] ?? {};
  const environments = useEnvironments();

  const [conditionKey, forceConditionRender] = useIncrementer();

  const defaultValues = {
    id: "",
    condition: getDefaultPrerequisiteCondition(),
  };

  const form = useForm<FeaturePrerequisite>({
    defaultValues: {
      id: prerequisite.id ?? defaultValues.id,
      condition: prerequisite.condition ?? defaultValues.condition,
    },
  });
  const { apiCall } = useAuth();

  const featureOptions = features
    .filter((f) => f.id !== feature.id)
    .filter((f) => (f.project || "") === (feature.project || ""))
    .map((f) => ({ label: f.id, value: f.id }));

  const parentFeature = features.find((f) => f.id === form.watch("id"));
  const parentFeatureId = parentFeature?.id;
  const parentCondition = form.watch("condition");

  const [isCyclic, cyclicFeatureId] = useMemo(() => {
    if (!parentFeatureId) return [false, null];
    const newFeature = cloneDeep(feature);
    const revision = revisions?.find((r) => r.version === version);
    newFeature.prerequisites = [...prerequisites];
    newFeature.prerequisites[i] = form.getValues();
    return isFeatureCyclic(newFeature, features, revision);
  }, [
    parentFeatureId,
    features,
    revisions,
    version,
    feature,
    prerequisites,
    form,
    i,
  ]);

  const canSubmit =
    !isCyclic &&
    !!parentFeature &&
    !!form.watch("id") &&
    !!form.watch("condition");

  useEffect(() => {
    if (parentFeature) {
      if (parentCondition === "") {
        const condStr = getDefaultPrerequisiteCondition(parentFeature);
        form.setValue("condition", condStr);
        forceConditionRender();
      }
    }
  }, [parentFeature, parentCondition, form, forceConditionRender]);

  return (
    <Modal
      open={true}
      close={close}
      size="lg"
      cta="Save"
      ctaEnabled={canSubmit}
      header={prerequisite ? "Edit Prerequisite" : "New Prerequisite"}
      submit={form.handleSubmit(async (values) => {
        const action = i === prerequisites.length ? "add" : "edit";

        track("Save Prerequisite", {
          source: action,
          prerequisiteIndex: i,
        });

        await apiCall<{ version: number }>(
          `/feature/${feature.id}/prerequisite`,
          {
            method: action === "add" ? "POST" : "PUT",
            body: JSON.stringify({
              prerequisite: values,
              i,
            }),
          }
        );
        mutate();
      })}
    >
      <div className="row mt-2 mb-3">
        <div className="col-4">
          <SelectField
            label="Prerequisite feature"
            options={featureOptions}
            value={form.watch("id")}
            onChange={(v) => {
              form.setValue("id", v);
              form.setValue("condition", "");
            }}
            sort={false}
          />
        </div>

        {parentFeature ? (
          <div className="col-8">
            <div className="border rounded px-3 pt-1 bg-light">
              <table className="table table-sm mb-0">
                <thead className="uppercase-title text-muted">
                  <tr>
                    <th className="border-top-0">Feature</th>
                    <th className="border-top-0">Type</th>
                    <th className="border-top-0">Default value</th>
                    <th className="border-top-0">Environments</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <a
                        href={`/features/${form.watch("id")}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {form.watch("id")}
                        <FaExternalLinkAlt className="ml-1" />
                      </a>
                    </td>
                    <td>
                      {parentFeature.valueType === "json"
                        ? "JSON"
                        : parentFeature.valueType}
                    </td>
                    <td>
                      <div
                        className={clsx({
                          small: parentFeature.valueType === "json",
                        })}
                      >
                        <ValueDisplay
                          value={getFeatureDefaultValue(parentFeature)}
                          type={parentFeature.valueType}
                          full={false}
                        />
                      </div>
                    </td>
                    <td>
                      <div className="d-flex small">
                        {environments.map((env) => (
                          <div key={env.id} className="mr-3">
                            <div className="font-weight-bold">{env.id}</div>
                            <div>
                              {parentFeature?.environmentSettings?.[env.id]
                                ?.enabled ? (
                                <span className="text-success font-weight-bold uppercase-title">
                                  ON
                                </span>
                              ) : (
                                <span className="text-danger font-weight-bold uppercase-title">
                                  OFF
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </div>

      {isCyclic && (
        <div className="alert alert-danger">
          <FaExclamationTriangle /> This prerequisite (
          <code>{cyclicFeatureId}</code>) creates a circular dependency. Remove
          this prerequisite to continue.
        </div>
      )}

      {parentFeature ? (
        <PrerequisiteInput
          defaultValue={form.watch("condition")}
          onChange={(value) => form.setValue("condition", value)}
          parentFeature={parentFeature}
          showPassIfLabel={true}
          key={conditionKey}
        />
      ) : null}
    </Modal>
  );
}
