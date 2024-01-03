import { useForm } from "react-hook-form";
import {
  ExperimentValue,
  FeatureInterface,
  FeaturePrerequisite,
  FeatureRule,
  ScheduleRule,
} from "back-end/types/feature";
import React, {useEffect, useMemo, useState} from "react";
import { date } from "shared/dates";
import uniqId from "uniqid";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import {getMatchingRules, includeExperimentInPayload, isFeatureCyclic} from "shared/util";
import {FaBell, FaExclamationTriangle, FaExternalLinkAlt} from "react-icons/fa";
import Link from "next/link";
import {
  NewExperimentRefRule,
  generateVariationId,
  getDefaultRuleValue,
  getDefaultVariationValue,
  getFeatureDefaultValue,
  getRules,
  useAttributeSchema,
  useEnvironments,
  useFeaturesList,
  validateFeatureRule,
  getPrerequisites, getDefaultPrerequisiteParentCondition,
} from "@/services/features";
import track from "@/services/track";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useExperiments } from "@/hooks/useExperiments";
import { useDefinitions } from "@/services/DefinitionsContext";
import useIncrementer from "@/hooks/useIncrementer";
import Field from "../Forms/Field";
import Modal from "../Modal";
import { useAuth } from "../../services/auth";
import SelectField from "../Forms/SelectField";
import UpgradeModal from "../Settings/UpgradeModal";
import StatusIndicator from "../Experiment/StatusIndicator";
import Toggle from "../Forms/Toggle";
import { getNewExperimentDatasourceDefaults } from "../Experiment/NewExperimentForm";
import TargetingInfo from "../Experiment/TabbedPage/TargetingInfo";
import EditTargetingModal from "../Experiment/EditTargetingModal";
import RolloutPercentInput from "./RolloutPercentInput";
import ConditionInput from "./ConditionInput";
import FeatureValueField from "./FeatureValueField";
import NamespaceSelector from "./NamespaceSelector";
import ScheduleInputs from "./ScheduleInputs";
import FeatureVariationsInput from "./FeatureVariationsInput";
import SavedGroupTargetingField from "./SavedGroupTargetingField";
import ForceSummary from "@/components/Features/ForceSummary";
import clsx from "clsx";
import ValueDisplay from "@/components/Features/ValueDisplay";
import cloneDeep from "lodash/cloneDeep";

export interface Props {
  close: () => void;
  feature: FeatureInterface;
  version: number;
  setVersion: (version: number) => void;
  mutate: () => void;
  i: number;
}

export default function PrerequisiteModal({
  close,
  feature,
  i,
  mutate,
  version,
  setVersion,
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
      description: prerequisite.description ?? defaultValues.description,
      parentCondition:
        prerequisite.parentCondition ?? defaultValues.parentCondition,
      enabled: prerequisite.enabled ?? defaultValues.enabled,
    },
  });
  const { apiCall } = useAuth();

  const featureOptions = features
    .filter((f) => f.id !== feature.id)
    .filter((f) => (f.project || "") === (feature.project || ""))
    .map((f) => ({ label: f.id, value: f.id }));

  const parentFeature = features.find((f) => f.id === form.watch("parentId"));

  const isCyclic = useMemo(() => {
    if (!parentFeature) return false;
    const newFeature = cloneDeep(feature);
    newFeature.prerequisites = [...prerequisites];
    newFeature.prerequisites[i] = form.getValues();
    return isFeatureCyclic(newFeature, features);
  }, [parentFeature?.id, features, i]);

  const canSubmit = !isCyclic && !!parentFeature && !!form.watch("parentId") && !!form.watch("parentCondition");

  useEffect(() => {
    if (parentFeature) forceConditionRender();
  }, [parentFeature]);

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
          hasDescription: values.description.length > 0,
        });

        // todo: don't use version?
        const res = await apiCall<{ version: number }>(
          `/feature/${feature.id}/${version}/prerequisite`,
          {
            method: action === "add" ? "POST" : "PUT",
            body: JSON.stringify({
              prerequisite: values,
              i,
            }),
          }
        );
        mutate();
        res.version && setVersion(res.version);
      })}
    >
      <div className="alert alert-info">
        {prerequisites[i] ? "Changes here" : "New prerequisites"} will be added
        to a draft revision. You will have a chance to review them first before
        making them live.
      </div>

      <Field
        label="Description (optional)"
        textarea
        minRows={1}
        {...form.register("description")}
        placeholder="Short human-readable description"
      />

      <SelectField
        label="Prerequisite feature"
        options={featureOptions}
        value={form.watch("parentId")}
        onChange={(v) => form.setValue("parentId", v)}
        sort={false}
      />

      {parentFeature ? (
        <table className="table table-sm border mb-3 bg-light">
          <thead className="uppercase-title">
            <tr>
              <th>Feature Key</th>
              <th>Type</th>
              <th>Default value</th>
              <th>Environments</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <a
                  href={`/features/${form.watch("parentId")}`}
                  target="_blank"
                >
                  {form.watch("parentId")}
                  <FaExternalLinkAlt className="ml-1" />
                </a>
              </td>
              <td>
                {parentFeature.valueType}
              </td>
              <td>
                <div
                  className={clsx({small: parentFeature.valueType === "json"})}
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
                      <div>{parentFeature?.environmentSettings?.[env.id]?.enabled ? (
                        <span className="text-success font-weight-bold uppercase-title">ON</span>
                      ) : (
                        <span className="text-danger font-weight-bold uppercase-title">OFF</span>
                      )}</div>
                    </div>
                  ))}
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      ) : null}

      {isCyclic && (
        <div className="alert alert-danger">
          <FaExclamationTriangle />{" "}
          This prerequisite (<code>{form.watch("parentId")}</code>) creates a circular dependency. Either remove this prerequisite or change the parent feature(s).
        </div>
      )}

      {parentFeature ? (
        <ConditionInput
          defaultValue={form.watch("parentCondition")}
          onChange={(value) => form.setValue("parentCondition", value)}
          isPrerequisite={true}
          parentFeature={parentFeature}
          key={conditionKey}
        />
      ) : null}
    </Modal>
  );
}
