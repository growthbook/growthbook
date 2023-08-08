import { useForm } from "react-hook-form";
import {
  ExperimentValue,
  FeatureInterface,
  FeatureRule,
  ScheduleRule,
} from "back-end/types/feature";
import { useState } from "react";
import {
  generateVariationId,
  getDefaultRuleValue,
  getFeatureDefaultValue,
  getRules,
  useAttributeSchema,
  validateFeatureRule,
} from "@/services/features";
import track from "@/services/track";
import useOrgSettings from "@/hooks/useOrgSettings";
import Field from "../Forms/Field";
import Modal from "../Modal";
import { useAuth } from "../../services/auth";
import SelectField from "../Forms/SelectField";
import UpgradeModal from "../Settings/UpgradeModal";
import RolloutPercentInput from "./RolloutPercentInput";
import ConditionInput from "./ConditionInput";
import FeatureValueField from "./FeatureValueField";
import NamespaceSelector from "./NamespaceSelector";
import ScheduleInputs from "./ScheduleInputs";
import FeatureVariationsInput from "./FeatureVariationsInput";

export interface Props {
  close: () => void;
  feature: FeatureInterface;
  mutate: () => void;
  i: number;
  environment: string;
  defaultType?: string;
}

export default function RuleModal({
  close,
  feature,
  i,
  mutate,
  environment,
  defaultType = "force",
}: Props) {
  const attributeSchema = useAttributeSchema();
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);

  const { namespaces } = useOrgSettings();

  const rules = getRules(feature, environment);
  const rule = rules[i];

  const defaultRuleValues = getDefaultRuleValue({
    defaultValue: getFeatureDefaultValue(feature),
    ruleType: defaultType,
    attributeSchema,
  });

  const defaultValues = {
    ...defaultRuleValues,
    ...((rule as FeatureRule) || {}),
  };

  const [scheduleToggleEnabled, setScheduleToggleEnabled] = useState(
    // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
    defaultValues.scheduleRules.some(
      (scheduleRule) => scheduleRule.timestamp !== null
    )
  );

  const form = useForm({
    // @ts-expect-error TS(2322) If you come across this, please fix it!: Type '{ type: "force"; value: string; description:... Remove this comment to see the full error message
    defaultValues,
  });
  const { apiCall } = useAuth();

  const type = form.watch("type");

  const hasHashAttributes =
    attributeSchema.filter((x) => x.hashAttribute).length > 0;

  if (showUpgradeModal) {
    return (
      <UpgradeModal
        close={() => setShowUpgradeModal(false)}
        reason="To enable feature flag scheduling,"
        source="schedule-feature-flag"
      />
    );
  }

  return (
    <Modal
      open={true}
      close={close}
      size="lg"
      cta="Save"
      header={rule ? "Edit Override Rule" : "New Override Rule"}
      submit={form.handleSubmit(async (values) => {
        const ruleAction = i === rules.length ? "add" : "edit";

        // If the user built a schedule, but disabled the toggle, we ignore the schedule
        if (!scheduleToggleEnabled) {
          values.scheduleRules = [];
        }

        // Loop through each scheduleRule and convert the timestamp to an ISOString()
        if (values.scheduleRules?.length) {
          values.scheduleRules?.forEach((scheduleRule: ScheduleRule) => {
            if (scheduleRule.timestamp === null) {
              return;
            }
            scheduleRule.timestamp = new Date(
              scheduleRule.timestamp
            ).toISOString();
          });

          // We currently only support a start date and end date, and if both are null, set schedule to empty array
          if (
            values.scheduleRules[0].timestamp === null &&
            values.scheduleRules[1].timestamp === null
          ) {
            values.scheduleRules = [];
          }
        }

        const rule = values as FeatureRule;

        try {
          const correctedRule = validateFeatureRule(rule, feature);
          if (correctedRule) {
            // @ts-expect-error TS(2345) If you come across this, please fix it!: Argument of type 'FeatureRule' is not assignable t... Remove this comment to see the full error message
            form.reset(correctedRule);
            throw new Error(
              "We fixed some errors in the rule. If it looks correct, submit again."
            );
          }

          track("Save Feature Rule", {
            source: ruleAction,
            ruleIndex: i,
            environment,
            type: values.type,
            // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
            hasCondition: rule.condition.length > 2,
            hasDescription: rule.description.length > 0,
          });

          await apiCall(`/feature/${feature.id}/rule`, {
            method: i === rules.length ? "POST" : "PUT",
            body: JSON.stringify({
              rule,
              environment,
              i,
            }),
          });
          mutate();
        } catch (e) {
          track("Feature Rule Error", {
            source: ruleAction,
            ruleIndex: i,
            environment,
            type: rule.type,
            // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
            hasCondition: rule.condition.length > 2,
            hasDescription: rule.description.length > 0,
            error: e.message,
          });

          throw e;
        }
      })}
    >
      <div className="alert alert-info">
        {rules[i] ? "Changes here" : "New rules"} will be added to a draft
        revision. You will have a chance to review them first before making them
        live.
      </div>
      <h3>{environment}</h3>
      <SelectField
        label="Type of Rule"
        readOnly={!!rules[i]}
        disabled={!!rules[i]}
        value={type}
        onChange={(v) => {
          const existingCondition = form.watch("condition");
          const newVal = {
            ...getDefaultRuleValue({
              defaultValue: getFeatureDefaultValue(feature),
              ruleType: v,
              attributeSchema,
            }),
            description: form.watch("description"),
          };
          if (existingCondition && existingCondition !== "{}") {
            newVal.condition = existingCondition;
          }
          // @ts-expect-error TS(2345) If you come across this, please fix it!: Argument of type '{ description: string; type: "fo... Remove this comment to see the full error message
          form.reset(newVal);
        }}
        options={[
          { label: "Forced Value", value: "force" },
          { label: "Percentage Rollout", value: "rollout" },
          { label: "A/B Experiment", value: "experiment" },
        ]}
      />
      <Field
        label="Description (optional)"
        textarea
        minRows={1}
        {...form.register("description")}
        placeholder="Short human-readable description of the rule"
      />
      <ConditionInput
        defaultValue={defaultValues.condition || ""}
        onChange={(value) => form.setValue("condition", value)}
      />
      {type === "force" && (
        <FeatureValueField
          label="Value to Force"
          id="value"
          value={form.watch("value")}
          setValue={(v) => form.setValue("value", v)}
          valueType={feature.valueType}
        />
      )}
      {/* @ts-expect-error TS(2367) If you come across this, please fix it!: This condition will always return 'false' since th... Remove this comment to see the full error message */}
      {type === "rollout" && (
        <div>
          <FeatureValueField
            label="Value to Rollout"
            id="value"
            value={form.watch("value")}
            setValue={(v) => form.setValue("value", v)}
            valueType={feature.valueType}
          />
          <RolloutPercentInput
            // @ts-expect-error TS(2322) If you come across this, please fix it!: Type 'readonly (string | boolean | ScheduleRule | ... Remove this comment to see the full error message
            value={form.watch("coverage")}
            setValue={(coverage) => {
              // @ts-expect-error TS(2345) If you come across this, please fix it!: Argument of type '"coverage"' is not assignable to... Remove this comment to see the full error message
              form.setValue("coverage", coverage);
            }}
          />
          <SelectField
            label="Assign value based on attribute"
            options={attributeSchema
              .filter((s) => !hasHashAttributes || s.hashAttribute)
              .map((s) => ({ label: s.property, value: s.property }))}
            // @ts-expect-error TS(2322) If you come across this, please fix it!: Type 'readonly (string | boolean | ScheduleRule | ... Remove this comment to see the full error message
            value={form.watch("hashAttribute")}
            onChange={(v) => {
              // @ts-expect-error TS(2345) If you come across this, please fix it!: Argument of type '"hashAttribute"' is not assignab... Remove this comment to see the full error message
              form.setValue("hashAttribute", v);
            }}
            helpText={
              "Will be hashed together with the Tracking Key to determine which variation to assign"
            }
          />
        </div>
      )}
      {/* @ts-expect-error TS(2367) If you come across this, please fix it!: This condition will always return 'false' since th... Remove this comment to see the full error message */}
      {type === "experiment" && (
        <div>
          <Field
            label="Tracking Key"
            // @ts-expect-error TS(2345) If you come across this, please fix it!: Argument of type '"trackingKey"' is not assignable... Remove this comment to see the full error message
            {...form.register(`trackingKey`)}
            placeholder={feature.id}
            helpText="Unique identifier for this experiment, used to track impressions and analyze results"
          />
          <SelectField
            label="Assign value based on attribute"
            options={attributeSchema
              .filter((s) => !hasHashAttributes || s.hashAttribute)
              .map((s) => ({ label: s.property, value: s.property }))}
            // @ts-expect-error TS(2322) If you come across this, please fix it!: Type 'readonly (string | boolean | ScheduleRule | ... Remove this comment to see the full error message
            value={form.watch("hashAttribute")}
            onChange={(v) => {
              // @ts-expect-error TS(2345) If you come across this, please fix it!: Argument of type '"hashAttribute"' is not assignab... Remove this comment to see the full error message
              form.setValue("hashAttribute", v);
            }}
            helpText={
              "Will be hashed together with the Tracking Key to determine which variation to assign"
            }
          />
          <FeatureVariationsInput
            defaultValue={getFeatureDefaultValue(feature)}
            valueType={feature.valueType}
            // @ts-expect-error TS(2322) If you come across this, please fix it!: Type 'readonly (string | boolean | ScheduleRule | ... Remove this comment to see the full error message
            coverage={form.watch("coverage")}
            // @ts-expect-error TS(2345) If you come across this, please fix it!: Argument of type '"coverage"' is not assignable to... Remove this comment to see the full error message
            setCoverage={(coverage) => form.setValue("coverage", coverage)}
            setWeight={(i, weight) =>
              // @ts-expect-error TS(2345) If you come across this, please fix it!: Argument of type '`values.${number}.weight`' is no... Remove this comment to see the full error message
              form.setValue(`values.${i}.weight`, weight)
            }
            variations={
              form
                // @ts-expect-error TS(2769) If you come across this, please fix it!: No overload matches this call.
                .watch("values")
                // @ts-expect-error TS(2345) If you come across this, please fix it!: Argument of type '(v: ExperimentValue & {    id?: ... Remove this comment to see the full error message
                .map((v: ExperimentValue & { id?: string }) => {
                  return {
                    value: v.value || "",
                    name: v.name,
                    weight: v.weight,
                    id: v.id || generateVariationId(),
                  };
                }) || []
            }
            // @ts-expect-error TS(2345) If you come across this, please fix it!: Argument of type '"values"' is not assignable to p... Remove this comment to see the full error message
            setVariations={(variations) => form.setValue("values", variations)}
          />
          {/* @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'. */}
          {namespaces?.length > 0 && (
            <NamespaceSelector
              form={form}
              // @ts-expect-error TS(2322) If you come across this, please fix it!: Type 'readonly (string | boolean | ScheduleRule | ... Remove this comment to see the full error message
              trackingKey={form.watch("trackingKey") || feature.id}
              featureId={feature.id}
              formPrefix=""
            />
          )}
        </div>
      )}
      <ScheduleInputs
        // @ts-expect-error TS(2322) If you come across this, please fix it!: Type 'ScheduleRule[] | undefined' is not assignabl... Remove this comment to see the full error message
        defaultValue={defaultValues.scheduleRules}
        onChange={(value) => form.setValue("scheduleRules", value)}
        scheduleToggleEnabled={scheduleToggleEnabled}
        setScheduleToggleEnabled={setScheduleToggleEnabled}
        setShowUpgradeModal={setShowUpgradeModal}
      />
    </Modal>
  );
}
