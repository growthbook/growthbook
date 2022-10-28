import { useForm } from "react-hook-form";
import {
  FeatureEnvironment,
  FeatureInterface,
  FeatureValueType,
} from "back-end/types/feature";
import { useAuth } from "../../services/auth";
import Field from "../Forms/Field";
import Modal from "../Modal";
import dJSON from "dirty-json";
import FeatureValueField from "./FeatureValueField";
import { useDefinitions } from "../../services/DefinitionsContext";
import track from "../../services/track";
import Toggle from "../Forms/Toggle";
import RadioSelector from "../Forms/RadioSelector";
import ConditionInput from "./ConditionInput";
import {
  getDefaultRuleValue,
  getDefaultValue,
  getDefaultVariationValue,
  useAttributeSchema,
  validateFeatureRule,
  validateFeatureValue,
  useEnvironments,
} from "../../services/features";
import RolloutPercentInput from "./RolloutPercentInput";
import VariationsInput from "./VariationsInput";
import NamespaceSelector from "./NamespaceSelector";
import TagsInput from "../Tags/TagsInput";
import cloneDeep from "lodash/cloneDeep";
import useOrgSettings from "../../hooks/useOrgSettings";
import { useWatching } from "../../services/WatchProvider";
import { ReactElement } from "react";
import usePermissions from "../../hooks/usePermissions";

export type Props = {
  close?: () => void;
  onSuccess: (feature: FeatureInterface) => Promise<void>;
  inline?: boolean;
  cta?: string;
  secondaryCTA?: ReactElement;
};

function parseDefaultValue(
  defaultValue: string,
  valueType: FeatureValueType
): string {
  if (valueType === "boolean") {
    return defaultValue === "true" ? "true" : "false";
  }
  if (valueType === "number") {
    return parseFloat(defaultValue) + "";
  }
  if (valueType === "string") {
    return defaultValue;
  }
  try {
    return JSON.stringify(dJSON.parse(defaultValue), null, 2);
  } catch (e) {
    throw new Error(`JSON parse error for default value`);
  }
}

export default function FeatureModal({
  close,
  onSuccess,
  inline,
  cta = "Create",
  secondaryCTA,
}: Props) {
  const { project, refreshTags } = useDefinitions();
  const environments = useEnvironments();
  const permissions = usePermissions();

  const { refreshWatching } = useWatching();

  const defaultEnvSettings: Record<string, FeatureEnvironment> = {};
  environments.forEach((e) => {
    let enabled = e.defaultState ?? true;
    if (!permissions.check("publishFeatures", project, [e.id])) enabled = false;

    defaultEnvSettings[e.id] = {
      enabled,
      rules: [],
    };
  });

  const form = useForm({
    defaultValues: {
      valueType: "boolean",
      defaultValue: getDefaultValue("boolean"),
      description: "",
      id: "",
      project: project,
      tags: [],
      environmentSettings: defaultEnvSettings,
      rule: null,
    },
  });
  const { apiCall } = useAuth();

  const attributeSchema = useAttributeSchema();

  const { namespaces } = useOrgSettings();

  const hasHashAttributes =
    attributeSchema.filter((x) => x.hashAttribute)?.length > 0;

  const valueType = form.watch("valueType") as FeatureValueType;
  const environmentSettings = form.watch("environmentSettings");

  const rule = form.watch("rule");

  return (
    <Modal
      inline={inline}
      size="lg"
      open={true}
      header="Create Feature"
      cta={cta}
      close={close}
      secondaryCTA={secondaryCTA}
      submit={form.handleSubmit(async (values) => {
        const { rule, defaultValue, ...feature } = values;
        const valueType = feature.valueType as FeatureValueType;

        const newDefaultValue = validateFeatureValue(
          valueType,
          defaultValue,
          rule ? "Fallback Value" : "Value"
        );
        let hasChanges = false;
        if (newDefaultValue !== defaultValue) {
          form.setValue("defaultValue", newDefaultValue);
          hasChanges = true;
        }

        if (rule) {
          feature.environmentSettings = cloneDeep(feature.environmentSettings);
          const newRule = validateFeatureRule(rule, valueType);
          if (newRule) {
            form.setValue("rule", newRule);
            hasChanges = true;
          }
          Object.keys(feature.environmentSettings).forEach((env) => {
            feature.environmentSettings[env].rules.push(rule);
          });
        }

        if (hasChanges) {
          throw new Error(
            "We fixed some errors in the feature. If it looks correct, submit again."
          );
        }

        const body = {
          ...feature,
          defaultValue: parseDefaultValue(defaultValue, valueType),
        };

        const res = await apiCall<{ feature: FeatureInterface }>(`/feature`, {
          method: "POST",
          body: JSON.stringify(body),
        });

        track("Feature Created", {
          valueType: values.valueType,
          hasDescription: values.description.length > 0,
          initialRule: rule?.type ?? "none",
        });
        if (rule) {
          track("Save Feature Rule", {
            source: "create-feature",
            ruleIndex: 0,
            type: rule.type,
            hasCondition: rule.condition.length > 2,
            hasDescription: false,
          });
        }
        refreshTags(values.tags);
        refreshWatching();

        await onSuccess(res.feature);
      })}
    >
      <Field
        label="Feature Key"
        {...form.register("id")}
        pattern="^[a-zA-Z0-9_.:|-]+$"
        required
        title="Only letters, numbers, and the characters '_-.:|' allowed. No spaces."
        helpText={
          <>
            Only letters, numbers, and the characters <code>_</code>,{" "}
            <code>-</code>, <code>.</code>, <code>:</code>, and <code>|</code>{" "}
            allowed. No spaces. <strong>Cannot be changed later!</strong>
          </>
        }
      />

      <div className="form-group">
        <label>Tags</label>
        <TagsInput
          value={form.watch("tags")}
          onChange={(tags) => form.setValue("tags", tags)}
        />
      </div>

      <label>Enabled Environments</label>
      <div className="row">
        {environments.map((env) => (
          <div className="col-auto" key={env.id}>
            <div className="form-group mb-0">
              <label htmlFor={`${env.id}_toggle_create`} className="mr-2 ml-3">
                {env.id}:
              </label>
              <Toggle
                id={`${env.id}_toggle_create`}
                label={env.id}
                disabledMessage="You don't have permission to create features in this environment."
                disabled={
                  !permissions.check("publishFeatures", project, [env.id])
                }
                value={environmentSettings[env.id].enabled}
                setValue={(on) => {
                  environmentSettings[env.id].enabled = on;
                  form.setValue("environmentSettings", environmentSettings);
                }}
                type="environment"
              />
            </div>
          </div>
        ))}
      </div>

      <hr />
      <h5>When Enabled</h5>

      <Field
        label="Value Type"
        value={valueType}
        onChange={(e) => {
          const val = e.target.value as FeatureValueType;
          const defaultValue = getDefaultValue(val);
          form.setValue("valueType", val);

          // Update values in rest of modal
          if (!rule) {
            form.setValue("defaultValue", defaultValue);
          } else if (rule.type === "force") {
            const otherVal = getDefaultVariationValue(defaultValue);
            form.setValue("defaultValue", otherVal);
            form.setValue("rule.value", defaultValue);
          } else if (rule.type === "rollout") {
            const otherVal = getDefaultVariationValue(defaultValue);
            form.setValue("defaultValue", otherVal);
            form.setValue("rule.value", defaultValue);
          } else if (rule.type === "experiment") {
            const otherVal = getDefaultVariationValue(defaultValue);
            form.setValue("defaultValue", otherVal);
            form.setValue("rule.coverage", 1);
            if (val === "boolean") {
              form.setValue("rule.values", [
                {
                  value: otherVal,
                  weight: 0.5,
                  name: "",
                },
                {
                  value: defaultValue,
                  weight: 0.5,
                  name: "",
                },
              ]);
            } else {
              for (let i = 0; i < rule.values.length; i++) {
                form.setValue(
                  `rule.values.${i}.value`,
                  i ? defaultValue : otherVal
                );
              }
            }
          }
        }}
        options={[
          {
            display: "boolean (on/off)",
            value: "boolean",
          },
          "number",
          "string",
          "json",
        ]}
      />

      <div className="form-group">
        <label>
          Behavior <small className="text-muted">(can change later)</small>
        </label>
        <RadioSelector
          name="ruleType"
          value={rule?.type || ""}
          labelWidth={145}
          options={[
            {
              key: "",
              display: "Simple",
              description: "All users get the same value",
            },
            {
              key: "force",
              display: "Targeted",
              description:
                "Most users get one value, a targeted segment gets another",
            },
            {
              key: "rollout",
              display: "Percentage Rollout",
              description:
                "Gradually release a value to users while everyone else gets a fallback",
            },
            {
              key: "experiment",
              display: "A/B Experiment",
              description: "Run an A/B test between multiple values.",
            },
          ]}
          setValue={(value) => {
            let defaultValue = getDefaultValue(valueType);

            if (!value) {
              form.setValue("rule", null);
              form.setValue("defaultValue", defaultValue);
            } else {
              defaultValue = getDefaultVariationValue(defaultValue);
              form.setValue("defaultValue", defaultValue);
              form.setValue("rule", {
                ...getDefaultRuleValue({
                  defaultValue: defaultValue,
                  ruleType: value,
                  attributeSchema,
                }),
              });
            }
          }}
        />
      </div>

      {!rule ? (
        <FeatureValueField
          label={"Value"}
          id="defaultValue"
          value={form.watch("defaultValue")}
          setValue={(v) => form.setValue("defaultValue", v)}
          valueType={valueType}
        />
      ) : rule?.type === "rollout" ? (
        <>
          <Field
            label="Sample users based on attribute"
            {...form.register("rule.hashAttribute")}
            options={attributeSchema
              .filter((s) => !hasHashAttributes || s.hashAttribute)
              .map((s) => s.property)}
            helpText="Will be hashed together with the feature key to determine if user is part of the rollout"
          />
          <RolloutPercentInput
            value={form.watch("rule.coverage")}
            setValue={(n) => {
              form.setValue("rule.coverage", n);
            }}
            label="Percent of users to include"
          />
          <ConditionInput
            defaultValue={rule?.condition}
            onChange={(cond) => {
              form.setValue("rule.condition", cond);
            }}
          />
          <FeatureValueField
            label={"Value to Rollout"}
            id="ruleValue"
            value={form.watch("rule.value")}
            setValue={(v) => form.setValue("rule.value", v)}
            valueType={valueType}
          />
          <FeatureValueField
            label={"Fallback Value"}
            id="defaultValue"
            value={form.watch("defaultValue")}
            setValue={(v) => form.setValue("defaultValue", v)}
            valueType={valueType}
            helpText={"For users not included in the rollout"}
          />
        </>
      ) : rule?.type === "force" ? (
        <>
          <ConditionInput
            defaultValue={rule?.condition}
            onChange={(cond) => {
              form.setValue("rule.condition", cond);
            }}
          />
          <FeatureValueField
            label={"Value to Force"}
            id="ruleValue"
            value={form.watch("rule.value")}
            setValue={(v) => form.setValue("rule.value", v)}
            valueType={valueType}
            helpText={
              <>
                When targeting conditions are <code>true</code>
              </>
            }
          />
          <FeatureValueField
            label={"Fallback Value"}
            id="defaultValue"
            value={form.watch("defaultValue")}
            setValue={(v) => form.setValue("defaultValue", v)}
            valueType={valueType}
            helpText={
              <>
                When targeting conditions are <code>false</code>
              </>
            }
          />
        </>
      ) : (
        <>
          <Field
            label="Tracking Key"
            {...form.register(`rule.trackingKey`)}
            placeholder={form.watch("id")}
            helpText="Unique identifier for this experiment, used to track impressions and analyze results."
          />
          <Field
            label="Sample users based on attribute"
            {...form.register("rule.hashAttribute")}
            options={attributeSchema
              .filter((s) => !hasHashAttributes || s.hashAttribute)
              .map((s) => s.property)}
            helpText="Will be hashed together with the Tracking Key to pick a value"
          />
          <ConditionInput
            defaultValue={rule?.condition}
            onChange={(cond) => {
              form.setValue("rule.condition", cond);
            }}
          />
          <VariationsInput
            coverage={form.watch("rule.coverage")}
            setCoverage={(coverage) => form.setValue("rule.coverage", coverage)}
            setWeight={(i, weight) =>
              form.setValue(`rule.values.${i}.weight`, weight)
            }
            variations={form.watch("rule.values") || []}
            setVariations={(variations) =>
              form.setValue("rule.values", variations)
            }
            defaultValue={rule?.values?.[0]?.value}
            valueType={valueType}
          />
          {namespaces?.length > 0 && (
            <NamespaceSelector
              form={form}
              formPrefix="rule."
              featureId={form.watch("id")}
              trackingKey={form.watch("rule.trackingKey")}
            />
          )}
          <FeatureValueField
            label={"Fallback Value"}
            helpText={"For people excluded from the experiment"}
            id="defaultValue"
            value={form.watch("defaultValue")}
            setValue={(v) => form.setValue("defaultValue", v)}
            valueType={valueType}
          />
        </>
      )}
    </Modal>
  );
}
