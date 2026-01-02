import { useFormContext } from "react-hook-form";
import { FeatureInterface, FeatureRule } from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { FaExclamationTriangle } from "react-icons/fa";
import Field from "@/components/Forms/Field";
import FeatureValueField from "@/components/Features/FeatureValueField";
import ScheduleInputs from "@/components/Features/ScheduleInputs";
import { NewExperimentRefRule } from "@/services/features";
import SavedGroupTargetingField from "@/components/Features/SavedGroupTargetingField";
import ConditionInput from "@/components/Features/ConditionInput";
import PrerequisiteTargetingField from "@/components/Features/PrerequisiteTargetingField";

export default function ForceValueFields({
  feature,
  environments,
  defaultValues,
  version,
  revisions,
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
  version: number;
  revisions?: FeatureRevisionInterface[];
  setPrerequisiteTargetingSdkIssues: (b: boolean) => void;
  isCyclic: boolean;
  cyclicFeatureId: string | null;
  conditionKey: number;
  scheduleToggleEnabled: boolean;
  setScheduleToggleEnabled: (b: boolean) => void;
}) {
  const form = useFormContext();

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
          label="Value to Force"
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
      <hr />

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
        revisions={revisions}
        version={version}
        environments={environments}
        setPrerequisiteTargetingSdkIssues={setPrerequisiteTargetingSdkIssues}
      />
      {isCyclic && (
        <div className="alert alert-danger">
          <FaExclamationTriangle /> A prerequisite (
          <code>{cyclicFeatureId}</code>) creates a circular dependency. Remove
          this prerequisite to continue.
        </div>
      )}
    </>
  );
}
