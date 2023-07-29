import { useForm } from "react-hook-form";
import {
  ExperimentValue,
  FeatureInterface,
  FeatureRule,
  ScheduleRule,
} from "back-end/types/feature";
import { useMemo, useState } from "react";
import { useFeatureIsOn } from "@growthbook/growthbook-react";
import {
  generateVariationId,
  getDefaultRuleValue,
  getDefaultVariationValue,
  getFeatureDefaultValue,
  getRules,
  useAttributeSchema,
  validateFeatureRule,
} from "@/services/features";
import track from "@/services/track";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useExperiments } from "@/hooks/useExperiments";
import { useDefinitions } from "@/services/DefinitionsContext";
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
  const showNewExperimentRule = useFeatureIsOn("new-experiment-rule");

  const { namespaces } = useOrgSettings();

  const rules = getRules(feature, environment);
  const rule = rules[i];

  const { project } = useDefinitions();

  const { experiments } = useExperiments(project);

  const defaultRuleValues = getDefaultRuleValue({
    defaultValue: getFeatureDefaultValue(feature),
    ruleType: defaultType,
    attributeSchema,
  });

  const defaultValues = {
    ...defaultRuleValues,
    ...rule,
  };

  const [scheduleToggleEnabled, setScheduleToggleEnabled] = useState(
    (defaultValues.scheduleRules || []).some(
      (scheduleRule) => scheduleRule.timestamp !== null
    )
  );

  const form = useForm<FeatureRule>({
    defaultValues,
  });
  const { apiCall } = useAuth();

  const type = form.watch("type");

  const hasHashAttributes =
    attributeSchema.filter((x) => x.hashAttribute).length > 0;

  const experimentId = form.watch("experimentId");
  const selectedExperiment = useMemo(() => {
    if (!experimentId) return null;
    const exp = experiments.find((e) => e.id === experimentId) || null;
    return exp;
  }, [experimentId, experiments]);

  if (showUpgradeModal) {
    return (
      <UpgradeModal
        close={() => setShowUpgradeModal(false)}
        reason="To enable feature flag scheduling,"
        source="schedule-feature-flag"
      />
    );
  }

  const ruleTypeOptions = [
    { label: "Forced Value", value: "force" },
    { label: "Percentage Rollout", value: "rollout" },
  ];

  if (showNewExperimentRule || type === "experiment-ref") {
    ruleTypeOptions.push({
      label: "A/B Experiment",
      value: "experiment-ref",
    });
    ruleTypeOptions.push({
      label: "Legacy Experiment",
      value: "experiment",
    });
  } else {
    ruleTypeOptions.push({ label: "A/B Experiment", value: "experiment" });
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
          // Validate a proper experiment was chosen and it has a value for every variation id
          if (rule.type === "experiment-ref") {
            const exp = experiments.find((e) => e.id === rule.experimentId);
            if (!exp) throw new Error("Must select an experiment");
            const variationIds = new Set(exp.variations.map((v) => v.id));

            if (rule.variations.length !== variationIds.size)
              throw new Error("Must specify a value for every variation");

            rule.variations.forEach((v) => {
              if (!variationIds.has(v.variationId)) {
                throw new Error("Unknown variation id: " + v.variationId);
              }
            });
          }

          const newRule = validateFeatureRule(rule, feature);
          if (newRule) {
            form.reset(newRule);
            throw new Error(
              "We fixed some errors in the rule. If it looks correct, submit again."
            );
          }

          track("Save Feature Rule", {
            source: ruleAction,
            ruleIndex: i,
            environment,
            type: values.type,
            hasCondition: rule.condition && rule.condition.length > 2,
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
            hasCondition: rule.condition && rule.condition.length > 2,
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
          form.reset(newVal);
        }}
        options={ruleTypeOptions}
      />
      {type !== "experiment-ref" && (
        <>
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
        </>
      )}
      {type === "force" && (
        <FeatureValueField
          label="Value to Force"
          id="value"
          value={form.watch("value")}
          setValue={(v) => form.setValue("value", v)}
          valueType={feature.valueType}
        />
      )}
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
            value={form.watch("coverage") || 0}
            setValue={(coverage) => {
              form.setValue("coverage", coverage);
            }}
          />
          <SelectField
            label="Assign value based on attribute"
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
        </div>
      )}
      {type === "experiment-ref" && (
        <div>
          <SelectField
            label="Experiment"
            initialOption="Choose One..."
            options={experiments.map((e) => ({
              label: e.name,
              value: e.id,
            }))}
            required
            value={experimentId || ""}
            onChange={(experimentId) => {
              form.setValue("experimentId", experimentId);

              const exp = experiments.find((e) => e.id === experimentId);
              if (exp) {
                const controlValue = getFeatureDefaultValue(feature);
                const variationValue = getDefaultVariationValue(controlValue);
                form.setValue(
                  "variations",
                  exp.variations.map((v, i) => ({
                    variationId: v.id,
                    value: i ? variationValue : controlValue,
                  }))
                );
              }
            }}
          />
          {selectedExperiment && (
            <div className="mb-3 bg-light border p-3">
              <h4>Variation Values</h4>
              {selectedExperiment.variations.map((v, i) => (
                <FeatureValueField
                  key={v.id}
                  label={v.name}
                  id={v.id}
                  value={form.watch(`variations.${i}.value`) || ""}
                  setValue={(v) => form.setValue(`variations.${i}.value`, v)}
                  valueType={feature.valueType}
                />
              ))}
            </div>
          )}
        </div>
      )}
      {type === "experiment" && (
        <div>
          <Field
            label="Tracking Key"
            {...form.register(`trackingKey`)}
            placeholder={feature.id}
            helpText="Unique identifier for this experiment, used to track impressions and analyze results"
          />
          <SelectField
            label="Assign value based on attribute"
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
          <FeatureVariationsInput
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
                .map((v: ExperimentValue & { id?: string }) => {
                  return {
                    value: v.value || "",
                    name: v.name,
                    weight: v.weight,
                    id: v.id || generateVariationId(),
                  };
                }) || []
            }
            setVariations={(variations) => form.setValue("values", variations)}
          />
          {namespaces && namespaces.length > 0 && (
            <NamespaceSelector
              form={form}
              trackingKey={form.watch("trackingKey") || feature.id}
              featureId={feature.id}
              formPrefix=""
            />
          )}
        </div>
      )}
      <ScheduleInputs
        defaultValue={defaultValues.scheduleRules || []}
        onChange={(value) => form.setValue("scheduleRules", value)}
        scheduleToggleEnabled={scheduleToggleEnabled}
        setScheduleToggleEnabled={setScheduleToggleEnabled}
        setShowUpgradeModal={setShowUpgradeModal}
      />
    </Modal>
  );
}
