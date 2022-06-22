import { useForm } from "react-hook-form";
import { FeatureInterface, FeatureRule } from "back-end/types/feature";
import Field from "../Forms/Field";
import Modal from "../Modal";
import FeatureValueField from "./FeatureValueField";
import { useAuth } from "../../services/auth";
import ConditionInput from "./ConditionInput";
import {
  getDefaultRuleValue,
  getFeatureDefaultValue,
  getRules,
  useAttributeSchema,
  validateFeatureRule,
} from "../../services/features";
import track from "../../services/track";
import RolloutPercentInput from "./RolloutPercentInput";
import VariationsInput from "./VariationsInput";
import NamespaceSelector from "./NamespaceSelector";
import useOrgSettings from "../../hooks/useOrgSettings";

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

  const { namespaces } = useOrgSettings();

  const rules = getRules(feature, environment);

  const defaultValues = {
    ...getDefaultRuleValue({
      defaultValue: getFeatureDefaultValue(feature),
      ruleType: defaultType,
      attributeSchema,
    }),
    ...((rules[i] as FeatureRule) || {}),
  };
  const form = useForm({
    defaultValues,
  });
  const { apiCall } = useAuth();

  const type = form.watch("type");

  const hasHashAttributes =
    attributeSchema.filter((x) => x.hashAttribute).length > 0;

  return (
    <Modal
      open={true}
      close={close}
      size="lg"
      cta="Save"
      header={rules[i] ? "Edit Override Rule" : "New Override Rule"}
      submit={form.handleSubmit(async (values) => {
        const ruleAction = i === rules.length ? "add" : "edit";
        const rule = values as FeatureRule;

        try {
          validateFeatureRule(rule, feature.valueType);

          track("Save Feature Rule", {
            source: ruleAction,
            ruleIndex: i,
            environment,
            type: values.type,
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
      <Field
        label="Type of Rule"
        readOnly={!!rules[i]}
        disabled={!!rules[i]}
        value={type}
        onChange={(e) => {
          const existingCondition = form.watch("condition");
          const newVal = {
            ...getDefaultRuleValue({
              defaultValue: getFeatureDefaultValue(feature),
              ruleType: e.target.value,
              attributeSchema,
            }),
            description: form.watch("description"),
          };
          if (existingCondition && existingCondition !== "{}") {
            newVal.condition = existingCondition;
          }
          form.reset(newVal);
        }}
        options={[
          { display: "Forced Value", value: "force" },
          { display: "Percentage Rollout", value: "rollout" },
          { display: "A/B Experiment", value: "experiment" },
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
          form={form}
          field="value"
          valueType={feature.valueType}
          type="secondary"
        />
      )}
      {type === "rollout" && (
        <div>
          <FeatureValueField
            label="Value to Rollout"
            form={form}
            field="value"
            valueType={feature.valueType}
            type="secondary"
          />
          <RolloutPercentInput
            value={form.watch("coverage")}
            setValue={(coverage) => {
              form.setValue("coverage", coverage);
            }}
          />
          <Field
            label="Sample users based on attribute"
            {...form.register("hashAttribute")}
            options={attributeSchema
              .filter((s) => !hasHashAttributes || s.hashAttribute)
              .map((s) => s.property)}
            helpText="Will be hashed together with the feature key to determine if user is part of the rollout"
          />
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
          <Field
            label="Assign value based on attribute"
            {...form.register("hashAttribute")}
            options={attributeSchema
              .filter((s) => !hasHashAttributes || s.hashAttribute)
              .map((s) => s.property)}
            helpText="Will be hashed together with the Tracking Key to pick a value"
          />
          <VariationsInput
            form={form}
            defaultValue={getFeatureDefaultValue(feature)}
            valueType={feature.valueType}
            formPrefix=""
          />
          {namespaces?.length > 0 && (
            <NamespaceSelector
              form={form}
              trackingKey={form.watch("trackingKey") || feature.id}
              featureId={feature.id}
              formPrefix=""
            />
          )}
        </div>
      )}
    </Modal>
  );
}
