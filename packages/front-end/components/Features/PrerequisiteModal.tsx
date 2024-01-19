import { useForm } from "react-hook-form";
import { FeatureInterface, FeaturePrerequisite } from "back-end/types/feature";
import React, { useEffect, useMemo } from "react";
import { isFeatureCyclic } from "shared/util";
import { FaExclamationTriangle, FaExternalLinkAlt } from "react-icons/fa";
import clsx from "clsx";
import cloneDeep from "lodash/cloneDeep";
import {
  getFeatureDefaultValue,
  useEnvironments,
  useFeaturesList,
  getPrerequisites,
  getDefaultPrerequisiteParentCondition,
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
}

export default function PrerequisiteModal({
  close,
  feature,
  i,
  mutate,
}: Props) {
  const { features } = useFeaturesList();
  const prerequisites = getPrerequisites(feature);
  const prerequisite = prerequisites[i] ?? {};
  const environments = useEnvironments();

  const [conditionKey, forceConditionRender] = useIncrementer();

  const defaultValues = {
    parentId: "",
    description: "",
    parentCondition: getDefaultPrerequisiteParentCondition(),
    enabled: true,
  };

  const form = useForm<FeaturePrerequisite>({
    defaultValues: {
      parentId: prerequisite.parentId ?? defaultValues.parentId,
      parentCondition:
        prerequisite.parentCondition ?? defaultValues.parentCondition,
    },
  });
  const { apiCall } = useAuth();

  const featureOptions = features
    .filter((f) => f.id !== feature.id)
    .filter((f) => (f.project || "") === (feature.project || ""))
    .map((f) => ({ label: f.id, value: f.id }));

  const parentFeature = features.find((f) => f.id === form.watch("parentId"));
  const parentFeatureId = parentFeature?.id;
  const parentCondition = form.watch("parentCondition");

  const isCyclic = useMemo(() => {
    if (!parentFeatureId) return false;
    const newFeature = cloneDeep(feature);
    newFeature.prerequisites = [...prerequisites];
    newFeature.prerequisites[i] = form.getValues();
    return isFeatureCyclic(newFeature, features);
  }, [parentFeatureId, features, feature, prerequisites, form, i]);

  const canSubmit =
    !isCyclic &&
    !!parentFeature &&
    !!form.watch("parentId") &&
    !!form.watch("parentCondition");

  useEffect(() => {
    if (parentFeature) {
      if (parentCondition === "") {
        const condStr = getDefaultPrerequisiteParentCondition(parentFeature);
        form.setValue("parentCondition", condStr);
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
            value={form.watch("parentId")}
            onChange={(v) => {
              form.setValue("parentId", v);
              form.setValue("parentCondition", "");
            }}
            sort={false}
          />
        </div>

        {parentFeature ? (
          <div className="col pl-4">
            <div className="border rounded px-3 pt-1 bg-light">
              <table className="table table-sm mb-0">
                <thead className="uppercase-title text-muted">
                  <tr>
                    <th className="border-top-0">Feature Key</th>
                    <th className="border-top-0">Type</th>
                    <th className="border-top-0">Default value</th>
                    <th className="border-top-0">Environments</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <a
                        href={`/features/${form.watch("parentId")}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {form.watch("parentId")}
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
          <code>{form.watch("parentId")}</code>) creates a circular dependency.
          Either remove this prerequisite or change the parent feature(s).
        </div>
      )}

      {parentFeature ? (
        <PrerequisiteInput
          defaultValue={form.watch("parentCondition")}
          onChange={(value) => form.setValue("parentCondition", value)}
          parentFeature={parentFeature}
          showPassIfLabel={true}
          key={conditionKey}
        />
      ) : null}
    </Modal>
  );
}
