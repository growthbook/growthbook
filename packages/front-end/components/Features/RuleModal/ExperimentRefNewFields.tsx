import { useFormContext } from "react-hook-form";
import {
  ExperimentValue,
  FeatureInterface,
  FeatureRule,
} from "back-end/types/feature";
import React from "react";
import { FaExclamationTriangle } from "react-icons/fa";
import { FeatureRevisionInterface } from "back-end/types/feature-revision";
import Field from "@/components/Forms/Field";
import useOrgSettings from "@/hooks/useOrgSettings";
import SelectField from "@/components/Forms/SelectField";
import FallbackAttributeSelector from "@/components/Features/FallbackAttributeSelector";
import HashVersionSelector, {
  allConnectionsSupportBucketingV2,
} from "@/components/Experiment/HashVersionSelector";
import {
  generateVariationId,
  getFeatureDefaultValue,
  NewExperimentRefRule,
  useAttributeSchema,
} from "@/services/features";
import useSDKConnections from "@/hooks/useSDKConnections";
import SavedGroupTargetingField from "@/components/Features/SavedGroupTargetingField";
import ConditionInput from "@/components/Features/ConditionInput";
import PrerequisiteTargetingField from "@/components/Features/PrerequisiteTargetingField";
import NamespaceSelector from "@/components/Features/NamespaceSelector";
import FeatureVariationsInput from "@/components/Features/FeatureVariationsInput";
import Toggle from "@/components/Forms/Toggle";
import ScheduleInputs from "@/components/Features/ScheduleInputs";

export default function ExperimentRefNewFields({
  feature,
  environment,
  defaultValues,
  revisions,
  version,
  setPrerequisiteTargetingSdkIssues,
  isCyclic,
  cyclicFeatureId,
  conditionKey,
  step,
  scheduleToggleEnabled,
  setScheduleToggleEnabled,
}: {
  feature: FeatureInterface;
  environment: string;
  defaultValues: FeatureRule | NewExperimentRefRule;
  revisions?: FeatureRevisionInterface[];
  version: number;
  setPrerequisiteTargetingSdkIssues: (b: boolean) => void;
  isCyclic: boolean;
  cyclicFeatureId: string | null;
  conditionKey: number;
  step: number;
  scheduleToggleEnabled: boolean;
  setScheduleToggleEnabled: (b: boolean) => void;
}) {
  const form = useFormContext();

  const attributeSchema = useAttributeSchema(false, feature.project);
  const hasHashAttributes =
    attributeSchema.filter((x) => x.hashAttribute).length > 0;

  const { data: sdkConnectionsData } = useSDKConnections();
  const hasSDKWithNoBucketingV2 = !allConnectionsSupportBucketingV2(
    sdkConnectionsData?.connections,
    feature.project
  );

  const { namespaces } = useOrgSettings();

  return (
    <>
      {step === 0 ? (
        <>
          <Field label="Experiment Name" {...form.register("name")} required />

          <Field
            label="Tracking Key"
            {...form.register(`trackingKey`)}
            placeholder={feature.id}
            helpText="Unique identifier for this Experiment, used to track impressions and analyze results"
          />

          <Field
            label="Hypothesis"
            textarea
            minRows={1}
            {...form.register("hypothesis")}
            placeholder="e.g. Making the signup button bigger will increase clicks and ultimately improve revenue"
          />

          <Field
            label="Description"
            textarea
            minRows={1}
            {...form.register("description")}
            placeholder="Short human-readable description of the Experiment"
          />
        </>
      ) : null}

      {step === 1 ? (
        <>
          <div className="mb-4">
            <div className="d-flex" style={{ gap: "2rem" }}>
              <SelectField
                label="Assign value based on attribute"
                containerClassName="flex-1"
                options={attributeSchema
                  .filter((s) => !hasHashAttributes || s.hashAttribute)
                  .map((s) => ({ label: s.property, value: s.property }))}
                value={form.watch("hashAttribute")}
                onChange={(v) => {
                  form.setValue("hashAttribute", v);
                }}
                helpText={
                  "Will be hashed together with the Tracking Key to determine which variation to assign"
                }
              />
              <FallbackAttributeSelector
                form={form}
                attributeSchema={attributeSchema}
              />
            </div>

            {hasSDKWithNoBucketingV2 && (
              <HashVersionSelector
                value={(form.watch("hashVersion") || 1) as 1 | 2}
                onChange={(v) => form.setValue("hashVersion", v)}
                project={feature.project}
              />
            )}
          </div>

          <FeatureVariationsInput
            label="Traffic Percent & Variations"
            defaultValue={getFeatureDefaultValue(feature)}
            valueType={feature.valueType}
            coverage={form.watch("coverage") || 0}
            setCoverage={(coverage) => form.setValue("coverage", coverage)}
            setWeight={(i, weight) =>
              form.setValue(`values.${i}.weight`, weight)
            }
            variations={
              form
                .watch("values")
                ?.map((v: ExperimentValue & { id?: string }) => {
                  return {
                    value: v.value || "",
                    name: v.name,
                    weight: v.weight,
                    id: v.id || generateVariationId(),
                  };
                }) || []
            }
            setVariations={(variations) => form.setValue("values", variations)}
            feature={feature}
          />

          {namespaces && namespaces.length > 0 && (
            <NamespaceSelector
              form={form}
              trackingKey={form.watch("trackingKey") || feature.id}
              featureId={feature.id}
              formPrefix=""
            />
          )}
        </>
      ) : null}

      {step === 2 ? (
        <>
          <SavedGroupTargetingField
            value={form.watch("savedGroups") || []}
            setValue={(savedGroups) =>
              form.setValue("savedGroups", savedGroups)
            }
            project={feature.project || ""}
          />
          <hr />
          <ConditionInput
            defaultValue={form.watch("condition") || ""}
            onChange={(value) => form.setValue("condition", value)}
            key={conditionKey}
            project={feature.project || ""}
          />
          <hr />
          <PrerequisiteTargetingField
            value={form.watch("prerequisites") || []}
            setValue={(prerequisites) =>
              form.setValue("prerequisites", prerequisites)
            }
            feature={feature}
            revisions={revisions}
            version={version}
            environments={[environment]}
            setPrerequisiteTargetingSdkIssues={
              setPrerequisiteTargetingSdkIssues
            }
          />
          {isCyclic && (
            <div className="alert alert-danger">
              <FaExclamationTriangle /> A prerequisite (
              <code>{cyclicFeatureId}</code>) creates a circular dependency.
              Remove this prerequisite to continue.
            </div>
          )}
          <hr />

          {form.watch("type") === "experiment-ref-new" && (
            <div className="mt-4 mb-3">
              <Toggle
                value={form.watch("autoStart")}
                setValue={(v) => form.setValue("autoStart", v)}
                id="auto-start-new-experiment"
              />{" "}
              <label htmlFor="auto-start-new-experiment" className="text-dark">
                Start Experiment Immediately
              </label>
              <div>
                <small className="form-text text-muted">
                  If On, the Experiment will start serving traffic as soon as
                  the feature is published. Leave Off if you want to make
                  additional changes before starting.
                </small>
              </div>
              {!form.watch("autoStart") && (
                <div>
                  <hr />
                  <ScheduleInputs
                    defaultValue={defaultValues.scheduleRules || []}
                    onChange={(value) => form.setValue("scheduleRules", value)}
                    scheduleToggleEnabled={scheduleToggleEnabled}
                    setScheduleToggleEnabled={setScheduleToggleEnabled}
                  />
                </div>
              )}
            </div>
          )}
        </>
      ) : null}
    </>
  );
}
