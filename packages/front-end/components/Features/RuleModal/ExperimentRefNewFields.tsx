import { useFormContext } from "react-hook-form";
import {
  FeatureInterface,
  FeaturePrerequisite,
  FeatureRule,
  SavedGroupTargeting,
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
import Checkbox from "@/components/Radix/Checkbox";

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
  prerequisiteValue,
  setPrerequisiteValue,
  setPrerequisiteTargetingSdkIssues,
  isCyclic,
  cyclicFeatureId,
  savedGroupValue,
  setSavedGroupValue,
  defaultConditionValue,
  setConditionValue,
  conditionKey,
  namespaceFormPrefix = "",
  scheduleToggleEnabled,
  setScheduleToggleEnabled,
  coverage,
  setCoverage,
  setWeight,
  variations,
  setVariations,
  orgStickyBucketing,
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
  prerequisiteValue: FeaturePrerequisite[];
  setPrerequisiteValue: (prerequisites: FeaturePrerequisite[]) => void;
  setPrerequisiteTargetingSdkIssues: (b: boolean) => void;
  isCyclic?: boolean;
  cyclicFeatureId?: string | null;
  savedGroupValue: SavedGroupTargeting[];
  setSavedGroupValue: (savedGroups: SavedGroupTargeting[]) => void;
  defaultConditionValue: string;
  setConditionValue: (s: string) => void;
  conditionKey: number;
  namespaceFormPrefix?: string;
  scheduleToggleEnabled?: boolean;
  setScheduleToggleEnabled?: (b: boolean) => void;
  coverage: number;
  setCoverage: (c: number) => void;
  setWeight: (i: number, w: number) => void;
  variations: SortableVariation[];
  setVariations: (v: SortableVariation[]) => void;
  orgStickyBucketing?: boolean;
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

            {orgStickyBucketing ? (
              <Checkbox
                mt="4"
                size="lg"
                label="Disable Sticky Bucketing"
                description="Do not persist variation assignments for this experiment (overrides your organization settings)"
                value={!!form.watch("disableStickyBucketing")}
                setValue={(v) => {
                  form.setValue("disableStickyBucketing", v);
                }}
              />
            ) : null}
          </div>

          <FeatureVariationsInput
            label="Traffic Percent & Variations"
            defaultValue={feature ? getFeatureDefaultValue(feature) : undefined}
            valueType={feature?.valueType ?? "string"}
            coverageLabel="Traffic included in this Experiment"
            coverageTooltip={`Users not included in the Experiment will skip this ${source}`}
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
              formPrefix={namespaceFormPrefix}
              trackingKey={form.watch("trackingKey") || feature?.id}
              featureId={feature?.id || ""}
            />
          )}
        </>
      ) : null}

      {step === 2 ? (
        <>
          <SavedGroupTargetingField
            value={savedGroupValue}
            setValue={setSavedGroupValue}
            project={project || ""}
          />
          <hr />
          <ConditionInput
            defaultValue={defaultConditionValue}
            onChange={setConditionValue}
            key={conditionKey}
            project={project || ""}
          />
          <hr />
          <PrerequisiteTargetingField
            value={prerequisiteValue}
            setValue={setPrerequisiteValue}
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
                {!form.watch("autoStart") && setScheduleToggleEnabled ? (
                  <div>
                    <hr />
                    <ScheduleInputs
                      defaultValue={defaultValues?.scheduleRules || []}
                      onChange={(value) =>
                        form.setValue("scheduleRules", value)
                      }
                      scheduleToggleEnabled={!!scheduleToggleEnabled}
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
