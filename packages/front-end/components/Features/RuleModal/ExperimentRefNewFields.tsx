import { useFormContext } from "react-hook-form";
import { FeatureInterface, FeatureRule } from "back-end/types/feature";
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
import { SortableVariation } from "@/components/Features/SortableFeatureVariationRow";

export default function ExperimentRefNewFields({
  step,
  source,
  feature,
  project,
  environment,
  environments,
  defaultValues,
  noSchedule,
  revisions,
  version,
  setPrerequisiteTargetingSdkIssues,
  isCyclic,
  cyclicFeatureId,
  conditionKey,
  scheduleToggleEnabled,
  setScheduleToggleEnabled,
  // variation input fields
  coverage,
  setCoverage,
  setWeight,
  variations,
  setVariations,
}: {
  step: number;
  source: "rule" | "experiment";
  feature?: FeatureInterface;
  project?: string;
  environment?: string;
  environments?: string[];
  defaultValues?: FeatureRule | NewExperimentRefRule;
  noSchedule?: boolean;
  revisions?: FeatureRevisionInterface[];
  version?: number;
  setPrerequisiteTargetingSdkIssues: (b: boolean) => void;
  isCyclic?: boolean;
  cyclicFeatureId?: string | null;
  conditionKey: number;
  scheduleToggleEnabled?: boolean;
  setScheduleToggleEnabled?: (b: boolean) => void;
  coverage: number;
  setCoverage: (c: number) => void;
  setWeight: (i: number, w: number) => void;
  variations: SortableVariation[];
  setVariations: (v: SortableVariation[]) => void;
}) {
  const form = useFormContext();

  const attributeSchema = useAttributeSchema(false, project);
  const hasHashAttributes =
    attributeSchema.filter((x) => x.hashAttribute).length > 0;

  const { data: sdkConnectionsData } = useSDKConnections();
  const hasSDKWithNoBucketingV2 = !allConnectionsSupportBucketingV2(
    sdkConnectionsData?.connections,
    project
  );

  const { namespaces } = useOrgSettings();

  return (
    <>
      {step === 0 ? (
        <>
          <Field
            required={true}
            minLength={2}
            label="Experiment Name"
            {...form.register("name")}
          />

          <Field
            label="Tracking Key"
            {...form.register(`trackingKey`)}
            placeholder={feature?.id || ""}
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

            {hasSDKWithNoBucketingV2 && (
              <HashVersionSelector
                value={(form.watch("hashVersion") || 1) as 1 | 2}
                onChange={(v) => form.setValue("hashVersion", v)}
                project={project}
              />
            )}
          </div>

          <FeatureVariationsInput
            label="Traffic Percent & Variations"
            defaultValue={feature ? getFeatureDefaultValue(feature) : undefined}
            valueType={feature?.valueType ?? "string"}
            coverageLabel="Traffic included in this Experiment"
            coverageTooltip={`Users not included in the Bandit will skip this ${source}`}
            coverage={coverage}
            setCoverage={setCoverage}
            setWeight={setWeight}
            variations={variations}
            setVariations={setVariations}
            feature={feature}
          />

          {namespaces && namespaces.length > 0 && (
            <NamespaceSelector
              form={form}
              trackingKey={form.watch("trackingKey") || feature?.id}
              featureId={feature?.id || ""}
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
            project={project || ""}
          />
          <hr />
          <ConditionInput
            defaultValue={form.watch("condition") || ""}
            onChange={(value) => form.setValue("condition", value)}
            key={conditionKey}
            project={project || ""}
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
            environments={environment ? [environment] : environments ?? []}
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

          {!noSchedule && form.watch("type") === "experiment-ref-new" ? (
            <>
              <hr />
              <div className="mt-4 mb-3">
                <Toggle
                  value={form.watch("autoStart")}
                  setValue={(v) => form.setValue("autoStart", v)}
                  id="auto-start-new-experiment"
                />{" "}
                <label
                  htmlFor="auto-start-new-experiment"
                  className="text-dark"
                >
                  Start Experiment Immediately
                </label>
                <div>
                  <small className="form-text text-muted">
                    If On, the Experiment will start serving traffic as soon as
                    the feature is published. Leave Off if you want to make
                    additional changes before starting.
                  </small>
                </div>
                {!form.watch("autoStart") &&
                scheduleToggleEnabled &&
                setScheduleToggleEnabled ? (
                  <div>
                    <hr />
                    <ScheduleInputs
                      defaultValue={defaultValues?.scheduleRules || []}
                      onChange={(value) =>
                        form.setValue("scheduleRules", value)
                      }
                      scheduleToggleEnabled={scheduleToggleEnabled}
                      setScheduleToggleEnabled={setScheduleToggleEnabled}
                    />
                  </div>
                ) : null}
              </div>
            </>
          ) : null}
        </>
      ) : null}
    </>
  );
}
