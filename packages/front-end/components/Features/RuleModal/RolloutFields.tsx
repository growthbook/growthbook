import { useFormContext } from "react-hook-form";
import { FeatureInterface, FeatureRule } from "shared/types/feature";
import { FaExclamationTriangle } from "react-icons/fa";
import { useState } from "react";
import { PiCaretDownFill, PiCaretUpFill } from "react-icons/pi";
import Field from "@/components/Forms/Field";
import FeatureValueField from "@/components/Features/FeatureValueField";
import RolloutPercentInput from "@/components/Features/RolloutPercentInput";
import SelectField from "@/components/Forms/SelectField";
import { NewExperimentRefRule, useAttributeSchema } from "@/services/features";
import ScheduleInputs from "@/components/Features/ScheduleInputs";
import SavedGroupTargetingField from "@/components/Features/SavedGroupTargetingField";
import ConditionInput from "@/components/Features/ConditionInput";
import PrerequisiteTargetingField from "@/components/Features/PrerequisiteTargetingField";

export default function RolloutFields({
  feature,
  environments,
  defaultValues,
  setPrerequisiteTargetingSdkIssues,
  isCyclic,
  cyclicFeatureId,
  conditionKey,
  scheduleToggleEnabled,
  setScheduleToggleEnabled,
}: {
  feature: FeatureInterface;
  environments: string[];
  defaultValues: FeatureRule | NewExperimentRefRule;
  setPrerequisiteTargetingSdkIssues: (b: boolean) => void;
  isCyclic: boolean;
  cyclicFeatureId: string | null;
  conditionKey: number;
  scheduleToggleEnabled: boolean;
  setScheduleToggleEnabled: (b: boolean) => void;
}) {
  const form = useFormContext();
  const [advancedOptionsOpen, setadvancedOptionsOpen] = useState(
    !!form.watch("seed"),
  );
  const attributeSchema = useAttributeSchema(false, feature.project);
  const hasHashAttributes =
    attributeSchema.filter((x) => x.hashAttribute).length > 0;

  const renderOverviewSteps = () => {
    return (
      <>
        <Field
          label="Description"
          textarea
          minRows={1}
          {...form.register("description")}
          placeholder="Short human-readable description of the rule"
        />

        <div className="mb-3 pb-1">
          <FeatureValueField
            label="Value to roll out"
            id="value"
            value={form.watch("value")}
            setValue={(v) => form.setValue("value", v)}
            valueType={feature.valueType}
            feature={feature}
            renderJSONInline={true}
            useCodeInput={true}
            showFullscreenButton={true}
          />
        </div>
        <ScheduleInputs
          defaultValue={defaultValues.scheduleRules || []}
          onChange={(value) => form.setValue("scheduleRules", value)}
          scheduleToggleEnabled={scheduleToggleEnabled}
          setScheduleToggleEnabled={setScheduleToggleEnabled}
        />

        <div className="appbox mt-4 mb-4 px-3 pt-3 bg-light">
          <RolloutPercentInput
            value={form.watch("coverage") || 0}
            setValue={(coverage) => {
              form.setValue("coverage", coverage);
            }}
            className="mb-3"
          />
          <SelectField
            label="Sample based on attribute"
            options={attributeSchema
              .filter((s) => !hasHashAttributes || s.hashAttribute)
              .map((s) => ({ label: s.property, value: s.property }))}
            value={form.watch("hashAttribute")}
            onChange={(v) => {
              form.setValue("hashAttribute", v);
            }}
          />
          <div className="mb-2">
            <span
              className="ml-auto link-purple cursor-pointer"
              onClick={(e) => {
                e.preventDefault();
                setadvancedOptionsOpen(!advancedOptionsOpen);
              }}
            >
              {!advancedOptionsOpen ? (
                <PiCaretDownFill className="mr-1" />
              ) : (
                <PiCaretUpFill className="mr-1" />
              )}
              Advanced Options
            </span>
            {advancedOptionsOpen && (
              <div className="mt-3">
                <Field
                  label="Seed"
                  type="input"
                  {...form.register("seed")}
                  placeholder={feature.id}
                  helpText={
                    <>
                      <strong className="text-danger">Warning:</strong> Changing
                      this will re-randomize rollout traffic.
                    </>
                  }
                />
              </div>
            )}
          </div>
        </div>

        <SavedGroupTargetingField
          value={form.watch("savedGroups") || []}
          setValue={(savedGroups) => form.setValue("savedGroups", savedGroups)}
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
          environments={environments}
          setPrerequisiteTargetingSdkIssues={setPrerequisiteTargetingSdkIssues}
        />
        {isCyclic && (
          <div className="alert alert-danger">
            <FaExclamationTriangle /> A prerequisite (
            <code>{cyclicFeatureId}</code>) creates a circular dependency.
            Remove this prerequisite to continue.
          </div>
        )}
      </>
    );
  };

  return <>{renderOverviewSteps()}</>;
}
