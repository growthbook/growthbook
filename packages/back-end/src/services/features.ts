import { FeatureDefinitionRule, FeatureDefinition } from "../../types/api";
import { FeatureValueType } from "../../types/feature";
import { getAllFeatures } from "../models/FeatureModel";

// eslint-disable-next-line
function getJSONValue(type: FeatureValueType, value: string): any {
  if (type === "json") {
    try {
      return JSON.parse(value);
    } catch (e) {
      return null;
    }
  }
  if (type === "number") return parseFloat(value) || 0;
  if (type === "string") return value;
  if (type === "boolean") return value === "false" ? false : true;
  return null;
}
export async function getFeatureDefinitions(organization: string) {
  const flags = await getAllFeatures(organization);

  const features: Record<string, FeatureDefinition> = {};
  flags.forEach((flag) => {
    features[flag.id] = {
      defaultValue: getJSONValue(flag.valueType, flag.defaultValue),
      rules:
        flag.rules
          ?.filter((r) => r.enabled)
          ?.map((r) => {
            const rule: FeatureDefinitionRule = {};
            if (r.condition) {
              rule.condition = JSON.parse(r.condition);
            }

            if (r.type === "force") {
              rule.type = "force";
              rule.value = getJSONValue(flag.valueType, r.value);
            } else if (r.type === "rollout") {
              rule.type = "experiment";
              rule.variations = r.values.map((v) =>
                getJSONValue(flag.valueType, v.value)
              );

              const totalWeight = r.values.reduce(
                (sum, r) => sum + r.weight,
                0
              );
              let multiplier = 1;
              if (totalWeight < 0.98 && totalWeight > 0) {
                rule.coverage = totalWeight;
                multiplier = 1 / totalWeight;
              }

              rule.weights = r.values.map((v) => v.weight * multiplier);
              if (r.trackingKey) {
                rule.trackingKey = r.trackingKey;
              }
              if (r.hashAttribute) {
                rule.hashAttribute = r.hashAttribute;
              }
            }
            return rule;
          }) ?? [],
    };
  });
}
