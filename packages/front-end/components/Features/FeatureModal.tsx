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
} from "../../services/features";
import RolloutPercentInput from "./RolloutPercentInput";
import VariationsInput from "./VariationsInput";
import NamespaceSelector from "./NamespaceSelector";
import TagsInput from "../Tags/TagsInput";
import cloneDeep from "lodash/cloneDeep";
import useOrgSettings from "../../hooks/useOrgSettings";
import { useEnvironments } from "../../services/features";

export type Props = {
  close: () => void;
  onSuccess: (feature: FeatureInterface) => Promise<void>;
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

export default function FeatureModal({ close, onSuccess }: Props) {
  const { project, refreshTags } = useDefinitions();
  const environments = useEnvironments();

  const defaultEnvSettings: Record<string, FeatureEnvironment> = {};
  environments.forEach(
    (e) => (defaultEnvSettings[e.id] = { enabled: true, rules: [] })
  );

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
      open={true}
      size="lg"
      header="Create Feature"
      cta="Create"
      close={close}
      submit={form.handleSubmit(async (values) => {
        const { rule, defaultValue, ...feature } = values;
        const valueType = feature.valueType as FeatureValueType;

        // Validate rule and add to all enabled environments (or just dev if none are enabled)
        if (rule) {
          feature.environmentSettings = cloneDeep(feature.environmentSettings);
          validateFeatureRule(rule, valueType);
          let envEnabled = false;
          Object.keys(feature.environmentSettings).forEach((env) => {
            if (feature.environmentSettings[env].enabled) {
              envEnabled = true;
              feature.environmentSettings[env].rules.push(rule);
            }
          });
          if (!envEnabled) {
            feature.environmentSettings.dev.rules.push(rule);
          }
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
                  name: "Control",
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
          form={form}
          field="defaultValue"
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
          <FeatureValueField
            label={"Value when included"}
            form={form}
            field="rule.value"
            valueType={valueType}
          />
          <FeatureValueField
            label={"Fallback value"}
            form={form}
            field="defaultValue"
            valueType={valueType}
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
            label={"Value When Targeted"}
            form={form}
            field="rule.value"
            valueType={valueType}
          />
          <FeatureValueField
            label={"Fallback Value"}
            form={form}
            field="defaultValue"
            valueType={valueType}
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
          <VariationsInput
            form={form}
            formPrefix="rule."
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
            form={form}
            field="defaultValue"
            valueType={valueType}
          />
        </>
      )}
    </Modal>
  );
}
