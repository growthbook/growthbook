import { useForm } from "react-hook-form";
import { FeatureInterface, FeatureValueType } from "back-end/types/feature";
import { useAuth } from "../../services/auth";
import Field from "../Forms/Field";
import Modal from "../Modal";
import dJSON from "dirty-json";
import FeatureValueField from "./FeatureValueField";
import { useDefinitions } from "../../services/DefinitionsContext";
import track from "../../services/track";
import Toggle from "../Forms/Toggle";
import uniq from "lodash/uniq";
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

export type Props = {
  close: () => void;
  onSuccess: (feature: FeatureInterface) => Promise<void>;
  existing?: FeatureInterface;
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

export default function FeatureModal({ close, existing, onSuccess }: Props) {
  const { project } = useDefinitions();
  const form = useForm<Partial<FeatureInterface>>({
    defaultValues: {
      valueType: existing?.valueType || "boolean",
      defaultValue:
        existing?.defaultValue ??
        getDefaultValue(existing?.valueType || "boolean"),
      description: existing?.description || "",
      id: existing?.id || "",
      project: existing?.project ?? project,
      environments: ["dev"],
      rules: [],
    },
  });
  const { apiCall } = useAuth();

  const attributeSchema = useAttributeSchema();

  const hasHashAttributes =
    attributeSchema.filter((x) => x.hashAttribute)?.length > 0;

  const valueType = form.watch("valueType");
  const environments = form.watch("environments");

  const rules = form.watch("rules");
  const rule = rules?.[0];

  return (
    <Modal
      open={true}
      size="lg"
      header="Create Feature"
      close={close}
      submit={form.handleSubmit(async (values) => {
        if (values.rules.length > 0) {
          validateFeatureRule(values.rules[0], valueType);
        }

        const body = {
          ...values,
          defaultValue: parseDefaultValue(
            values.defaultValue,
            values.valueType
          ),
        };

        if (existing) {
          delete body.id;
        }

        const res = await apiCall<{ feature: FeatureInterface }>(
          existing ? `/feature/${existing.id}` : `/feature`,
          {
            method: existing ? "PUT" : "POST",
            body: JSON.stringify(body),
          }
        );

        if (!existing) {
          track("Feature Created", {
            valueType: values.valueType,
            hasDescription: values.description.length > 0,
            initialRule: values.rules?.[0]?.type ?? "none",
          });
          if (values.rules?.length > 0) {
            track("Save Feature Rule", {
              source: "create-feature",
              ruleIndex: 0,
              type: values.rules[0].type,
              hasCondition: values.rules[0].condition.length > 2,
              hasDescription: false,
            });
          }
        }

        await onSuccess(res.feature);
      })}
    >
      {!existing && (
        <Field
          label="Feature Key"
          {...form.register("id")}
          pattern="^[a-zA-Z0-9_.:|-]+$"
          required
          disabled={!!existing}
          readOnly={!!existing}
          title="Only letters, numbers, and the characters '_-.:|' allowed. No spaces."
          helpText={
            <>
              Only letters, numbers, and the characters <code>_</code>,{" "}
              <code>-</code>, <code>.</code>, <code>:</code>, and <code>|</code>{" "}
              allowed. No spaces. <strong>Cannot be changed later!</strong>
            </>
          }
        />
      )}

      <label>Enabled Environments</label>
      <div className="row">
        <div className="col-auto">
          <div className="form-group mb-0">
            <label htmlFor={"dev_toggle_create"} className="mr-2 ml-3">
              Dev:
            </label>
            <Toggle
              id={"dev_toggle_create"}
              label="Dev"
              value={environments.includes("dev") ?? false}
              setValue={(on) => {
                let envs = [...environments];
                if (on) envs.push("dev");
                else envs = envs.filter((e) => e !== "dev");
                form.setValue("environments", uniq(envs));
              }}
            />
          </div>
        </div>
        <div className="col-auto">
          <div className="form-group mb-0">
            <label htmlFor={"production_toggle_create"} className="mr-2">
              Production:
            </label>
            <Toggle
              id={"production_toggle_create"}
              label="Production"
              value={environments.includes("production") ?? false}
              setValue={(on) => {
                let envs = [...environments];
                if (on) envs.push("production");
                else envs = envs.filter((e) => e !== "production");
                form.setValue("environments", uniq(envs));
              }}
            />
          </div>
        </div>
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
            form.setValue("rules.0.value", defaultValue);
          } else if (rule.type === "rollout") {
            const otherVal = getDefaultVariationValue(defaultValue);
            form.setValue("defaultValue", otherVal);
            form.setValue("rules.0.value", defaultValue);
          } else if (rule.type === "experiment") {
            const otherVal = getDefaultVariationValue(defaultValue);
            form.setValue("defaultValue", otherVal);

            if (val === "boolean") {
              form.setValue("rules.0.values", [
                {
                  value: otherVal,
                  weight: 0.5,
                },
                {
                  value: defaultValue,
                  weight: 0.5,
                },
              ]);
            } else {
              for (let i = 0; i < rule.values.length; i++) {
                form.setValue(
                  `rules.0.values.${i}.value`,
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
          value={rules?.[0]?.type || ""}
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
              form.setValue("rules", []);
              form.setValue("defaultValue", defaultValue);
            } else {
              defaultValue = getDefaultVariationValue(defaultValue);
              form.setValue("defaultValue", defaultValue);
              form.setValue("rules", [
                {
                  ...getDefaultRuleValue({
                    defaultValue: defaultValue,
                    ruleType: value,
                    attributeSchema,
                  }),
                },
              ]);
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
            {...form.register("rules.0.hashAttribute")}
            options={attributeSchema
              .filter((s) => !hasHashAttributes || s.hashAttribute)
              .map((s) => s.property)}
            helpText="Will be hashed together with the feature key to determine if user is part of the rollout"
          />
          <RolloutPercentInput
            value={form.watch("rules.0.coverage")}
            setValue={(n) => {
              form.setValue("rules.0.coverage", n);
            }}
            label="Percent of users to include"
          />
          <FeatureValueField
            label={"Value when included"}
            form={form}
            field="rules.0.value"
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
              form.setValue("rules.0.condition", cond);
            }}
          />
          <FeatureValueField
            label={"Value When Targeted"}
            form={form}
            field="rules.0.value"
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
            {...form.register(`rules.0.trackingKey`)}
            placeholder={form.watch("id")}
            helpText="Unique identifier for this experiment, used to track impressions and analyze results"
          />
          <Field
            label="Sample users based on attribute"
            {...form.register("rules.0.hashAttribute")}
            options={attributeSchema
              .filter((s) => !hasHashAttributes || s.hashAttribute)
              .map((s) => s.property)}
            helpText="Will be hashed together with the Tracking Key to pick a value"
          />
          <VariationsInput
            form={form}
            formPrefix="rules.0."
            defaultValue={rule?.values?.[0]?.value}
            valueType={valueType}
          />
          <NamespaceSelector form={form} formPrefix="rules.0." />
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
