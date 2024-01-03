import { useForm } from "react-hook-form";
import {
  ExperimentValue,
  FeatureInterface,
  FeaturePrerequisite,
  FeatureRule,
  ScheduleRule,
} from "back-end/types/feature";
import React, {useEffect, useState} from "react";
import { date } from "shared/dates";
import uniqId from "uniqid";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { getMatchingRules, includeExperimentInPayload } from "shared/util";
import { FaBell, FaExternalLinkAlt } from "react-icons/fa";
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
  const environments = useEnvironments();

  const prerequisites = getPrerequisites(feature);
  const prerequisite = prerequisites[i] ?? {};

  const [showTargetingModal, setShowTargetingModal] = useState(false);

  const settings = useOrgSettings();

  const [conditionKey, forceConditionRender] = useIncrementer();

  const { features } = useFeaturesList();

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

  useEffect(() => {
    if (parentFeature) forceConditionRender();
  }, [parentFeature]);
  
  // function changeRuleType(v: string) {
  //   const existingCondition = form.watch("condition");
  //   const existingSavedGroups = form.watch("savedGroups");
  //   const newVal = {
  //     ...getDefaultRuleValue({
  //       defaultValue: getFeatureDefaultValue(feature),
  //       ruleType: v,
  //       attributeSchema,
  //     }),
  //     description: form.watch("description"),
  //   };
  //   if (existingCondition && existingCondition !== "{}") {
  //     newVal.condition = existingCondition;
  //   }
  //   if (existingSavedGroups) {
  //     newVal.savedGroups = existingSavedGroups;
  //   }
  //   form.reset(newVal);
  // }

  return (
    <Modal
      open={true}
      close={close}
      size="lg"
      cta="Save"
      header={prerequisite ? "Edit Prerequisite" : "New Prerequisite"}
      submit={form.handleSubmit(async (values) => {
        const prerequisiteAction = i === prerequisites.length ? "add" : "edit";

        try {
          // const correctedRule = validateFeatureRule(values, feature);
          // const correctedParentCondition = validateParentCondition(values, features);
          // if (correctedRule) {
          //   form.reset(correctedRule);
          //   throw new Error(
          //     "We fixed some errors in the rule. If it looks correct, submit again."
          //   );
          // }

          track("Save Prerequisite", {
            source: prerequisiteAction,
            prerequisiteIndex: i,
            hasDescription: values.description.length > 0,
          });

          const res = await apiCall<{ version: number }>(
            `/feature/${feature.id}/${version}/prerequisite`,
            {
              method: i === prerequisites.length ? "POST" : "PUT",
              body: JSON.stringify({
                prerequisite: values,
                i,
              }),
            }
          );
          await mutate();
          res.version && setVersion(res.version);
        } catch (e) {
          track("Prerequisite Error", {
            source: prerequisiteAction,
            prerequisiteIndex: i,
            hasDescription: values.description.length > 0,
            error: e.message,
          });
          // forceConditionRender();

          throw e;
        }
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
