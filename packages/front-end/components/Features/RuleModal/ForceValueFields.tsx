import { useFormContext } from "react-hook-form";
import { FeatureInterface, FeatureRule } from "back-end/types/feature";
import { FeatureRevisionInterface } from "back-end/types/feature-revision";
import Page from "@/components/Modal/Page";
import Field from "@/components/Forms/Field";
import FeatureValueField from "@/components/Features/FeatureValueField";
import ScheduleInputs from "@/components/Features/ScheduleInputs";
import { NewExperimentRefRule } from "@/services/features";
import SavedGroupTargetingField from "@/components/Features/SavedGroupTargetingField";
import ConditionInput from "@/components/Features/ConditionInput";
import PrerequisiteTargetingField from "@/components/Features/PrerequisiteTargetingField";
import { useIncrementer } from "@/hooks/useIncrementer";
import {FaExclamationTriangle} from "react-icons/fa";

export default function ForceValueFields({
  feature,
  environment,
  defaultValues,
  version,
  revisions,
  setPrerequisiteTargetingSdkIssues,
  isCyclic,
  cyclicFeatureId,
  // legacy:
  scheduleToggleEnabled,
  setScheduleToggleEnabled,
  setShowUpgradeModal,
}: {
  feature: FeatureInterface;
  environment: string;
  defaultValues: FeatureRule | NewExperimentRefRule;
  version: number;
  revisions?: FeatureRevisionInterface[];
  setPrerequisiteTargetingSdkIssues: (b: boolean) => void;
  isCyclic: boolean;
  cyclicFeatureId: string | null;

  scheduleToggleEnabled: boolean;
  setScheduleToggleEnabled: (b: boolean) => void;
  setShowUpgradeModal: (b: boolean) => void;
}) {
  const form = useFormContext();

  const [conditionKey, forceConditionRender] = useIncrementer();

  return (
    <>
      <Page display="Force Value">
        <Field
          label="Description"
          textarea
          minRows={1}
          {...form.register("description")}
          placeholder="Short human-readable description of the rule"
        />

        <FeatureValueField
          label="Value to Force"
          id="value"
          value={form.watch("value")}
          setValue={(v) => form.setValue("value", v)}
          valueType={feature.valueType}
          feature={feature}
          renderJSONInline={true}
        />

        <ScheduleInputs
          defaultValue={defaultValues.scheduleRules || []}
          onChange={(value) => form.setValue("scheduleRules", value)}
          scheduleToggleEnabled={scheduleToggleEnabled}
          setScheduleToggleEnabled={setScheduleToggleEnabled}
          setShowUpgradeModal={setShowUpgradeModal}
          title="Add scheduling to automatically enable/disable this rule"
        />
      </Page>

      <Page display="Targeting">
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
          environments={[environment]}
          setPrerequisiteTargetingSdkIssues={setPrerequisiteTargetingSdkIssues}
        />
        {isCyclic && (
          <div className="alert alert-danger">
            <FaExclamationTriangle /> A prerequisite (
            <code>{cyclicFeatureId}</code>) creates a circular dependency. Remove
            this prerequisite to continue.
          </div>
        )}
      </Page>
    </>
  );
}
