import { useForm } from "react-hook-form";
import {
  FeatureEnvironment,
  FeatureInterface,
  FeatureValueType,
} from "back-end/types/feature";
import dJSON from "dirty-json";
import cloneDeep from "lodash/cloneDeep";
import { ReactElement } from "react";
import { useAuth } from "@/services/auth";
import Modal from "@/components/Modal";
import { useDefinitions } from "@/services/DefinitionsContext";
import track from "@/services/track";
import {
  getDefaultRuleValue,
  getDefaultValue,
  getDefaultVariationValue,
  useAttributeSchema,
  validateFeatureRule,
  validateFeatureValue,
  useEnvironments,
  genDuplicatedKey,
} from "@/services/features";
import { useWatching } from "@/services/WatchProvider";
import usePermissions from "@/hooks/usePermissions";
import FeatureValueField from "../FeatureValueField";
import FeatureKeyField from "./FeatureKeyField";
import EnvironmentSelect from "./EnvironmentSelect";
import TagsField from "./TagsField";
import ValueTypeField from "./ValueTypeField";
import RuleSelect from "./RuleSelect";
import RolloutRuleDefaultValuesField from "./RolloutRuleDefaultValuesField";
import ForceRuleDefaultValuesField from "./ForceRuleDefaultValuesField";
import ExperimentRuleDefaultValuesField from "./ExperimentRuleDefaultValuesField";

export type Props = {
  close?: () => void;
  onSuccess: (feature: FeatureInterface) => Promise<void>;
  inline?: boolean;
  cta?: string;
  secondaryCTA?: ReactElement;
  featureToDuplicate?: FeatureInterface;
  features?: FeatureInterface[];
  initialRule?: boolean;
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

const genEnvironmentSettings = ({
  environments,
  featureToDuplicate,
  permissions,
  project,
}: {
  environments: ReturnType<typeof useEnvironments>;
  featureToDuplicate?: FeatureInterface;
  permissions: ReturnType<typeof usePermissions>;
  project: string;
}): Record<string, FeatureEnvironment> => {
  const envSettings: Record<string, FeatureEnvironment> = {};

  environments.forEach((e) => {
    const canPublish = permissions.check("publishFeatures", project, [e.id]);
    const defaultEnabled = canPublish ? e.defaultState ?? true : false;
    const enabled = canPublish
      ? featureToDuplicate?.environmentSettings?.[e.id]?.enabled ??
        defaultEnabled
      : false;
    const rules = featureToDuplicate?.environmentSettings?.[e.id]?.rules ?? [];

    envSettings[e.id] = { enabled, rules };
  });

  return envSettings;
};

const genFormDefaultValues = ({
  environments,
  permissions,
  featureToDuplicate,
  project,
}: {
  environments: ReturnType<typeof useEnvironments>;
  permissions: ReturnType<typeof usePermissions>;
  featureToDuplicate?: FeatureInterface;
  project: string;
}) => {
  const environmentSettings = genEnvironmentSettings({
    environments,
    featureToDuplicate,
    permissions,
    project,
  });
  return featureToDuplicate
    ? {
        valueType: featureToDuplicate.valueType,
        defaultValue: featureToDuplicate.defaultValue,
        description: featureToDuplicate.description,
        id: genDuplicatedKey(featureToDuplicate),
        project: featureToDuplicate.project ?? project,
        tags: featureToDuplicate.tags,
        environmentSettings,
        rule: null,
      }
    : {
        valueType: "boolean",
        defaultValue: getDefaultValue("boolean"),
        description: "",
        id: "",
        project,
        tags: [],
        environmentSettings,
        rule: null,
      };
};

export default function FeatureModal({
  close,
  onSuccess,
  inline,
  cta = "Create",
  secondaryCTA,
  featureToDuplicate,
  initialRule = true,
}: Props) {
  const { project, refreshTags } = useDefinitions();
  const environments = useEnvironments();
  const permissions = usePermissions();
  const { refreshWatching } = useWatching();

  const defaultValues = genFormDefaultValues({
    environments,
    permissions,
    featureToDuplicate,
    project,
  });

  const form = useForm({ defaultValues });

  const { apiCall } = useAuth();
  const attributeSchema = useAttributeSchema();

  const valueType = form.watch("valueType") as FeatureValueType;
  const environmentSettings = form.watch("environmentSettings");
  const rule = form.watch("rule");

  const modalHeader = featureToDuplicate
    ? `Duplicate Feature (${featureToDuplicate.id})`
    : "Create Feature";

  return (
    <Modal
      open
      size="lg"
      inline={inline}
      header={modalHeader}
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
      <FeatureKeyField keyField={form.register("id")} />

      <TagsField
        value={form.watch("tags")}
        onChange={(tags) => form.setValue("tags", tags)}
      />

      <EnvironmentSelect
        environmentSettings={environmentSettings}
        setValue={(env, on) => {
          environmentSettings[env.id].enabled = on;
          form.setValue("environmentSettings", environmentSettings);
        }}
      />

      {/* 
          We hide rule configuration when duplicating a feature since the 
          decision of which rule to display (out of potentially many) in the 
          modal is not deterministic.
      */}
      {!featureToDuplicate && (
        <>
          <hr />

          <h5>When Enabled</h5>

          <ValueTypeField
            value={valueType}
            onChange={(val) => {
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
          />

          {initialRule && (
            <RuleSelect
              value={rule?.type || ""}
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
          )}

          {!rule ? (
            <FeatureValueField
              label={"Value"}
              id="defaultValue"
              value={form.watch("defaultValue")}
              setValue={(v) => form.setValue("defaultValue", v)}
              valueType={valueType}
            />
          ) : rule?.type === "rollout" ? (
            <RolloutRuleDefaultValuesField
              {...form.register("rule.hashAttribute")}
              coverageValue={form.watch("rule.coverage")}
              setCoverageValue={(n) => form.setValue("rule.coverage", n)}
              conditionValue={rule?.condition}
              setConditionValue={(cond) =>
                form.setValue("rule.condition", cond)
              }
              rolloutValue={form.watch("rule.value")}
              setRolloutValue={(v) => form.setValue("rule.value", v)}
              valueType={valueType}
              fallbackValue={form.watch("defaultValue")}
              setFallbackValue={(v) => form.setValue("defaultValue", v)}
            />
          ) : rule?.type === "force" ? (
            <ForceRuleDefaultValuesField
              valueType={valueType}
              conditionValue={rule?.condition}
              setConditionValue={(cond) =>
                form.setValue("rule.condition", cond)
              }
              ruleValue={form.watch("rule.value")}
              setRuleValue={(v) => form.setValue("rule.value", v)}
              fallbackValue={form.watch("defaultValue")}
              setFallbackValue={(v) => form.setValue("defaultValue", v)}
            />
          ) : (
            <ExperimentRuleDefaultValuesField
              featureKey={form.watch("id")}
              hashAttributeFormField={form.register("rule.hashAttribute")}
              trackingKeyFormField={form.register(`rule.trackingKey`)}
              trackingKeyValue={form.watch("rule.trackingKey")}
              conditionValue={rule?.condition}
              setConditionValue={(cond) => {
                form.setValue("rule.condition", cond);
              }}
              coverageValue={form.watch("rule.coverage")}
              setCoverageValue={(coverage) =>
                form.setValue("rule.coverage", coverage)
              }
              setWeight={(i, weight) =>
                form.setValue(`rule.values.${i}.weight`, weight)
              }
              variations={form.watch("rule.values") || []}
              setVariations={(variations) =>
                form.setValue("rule.values", variations)
              }
              variationsDefaultValue={rule?.values?.[0]?.value}
              valueType={valueType}
              form={form}
              fallbackValue={form.watch("defaultValue")}
              setFallbackValue={(v) => form.setValue("defaultValue", v)}
            />
          )}
          {!initialRule && (
            <p>
              You can add complex rules later to control exactly how and when
              this feature gets released to users.
            </p>
          )}
        </>
      )}
    </Modal>
  );
}
