import { FeatureDefinitionRule, FeatureDefinition } from "../../types/api";
import { FeatureInterface, FeatureValueType } from "../../types/feature";
import { queueWebhook } from "../jobs/webhooks";
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
  const features = await getAllFeatures(organization);

  const defs: Record<string, FeatureDefinition> = {};
  features.forEach((feature) => {
    defs[feature.id] = {
      defaultValue: getJSONValue(feature.valueType, feature.defaultValue),
      rules:
        feature.rules
          ?.filter((r) => r.enabled)
          ?.map((r) => {
            const rule: FeatureDefinitionRule = {};
            if (r.condition) {
              try {
                rule.condition = JSON.parse(r.condition);
              } catch (e) {
                // ignore condition parse errors here
              }
            }

            if (r.type === "force") {
              rule.force = getJSONValue(feature.valueType, r.value);
            } else if (r.type === "rollout") {
              rule.variations = r.values.map((v) =>
                getJSONValue(feature.valueType, v.value)
              );

              const weights = r.values
                .map((v) => v.weight)
                .map((w) => (w < 0 ? 0 : w > 1 ? 1 : w));
              const totalWeight = weights.reduce((sum, w) => sum + w, 0);
              if (totalWeight <= 0) {
                rule.coverage = 0;
              } else if (totalWeight < 1) {
                rule.coverage = totalWeight;
              }

              const multiplier = totalWeight > 0 ? 1 / totalWeight : 0;
              rule.weights = weights.map(
                (w) => Math.floor(w * multiplier * 1000) / 1000
              );

              if (r.trackingKey) {
                rule.key = r.trackingKey;
              }
              if (r.hashAttribute) {
                rule.hashAttribute = r.hashAttribute;
              }
            }
            return rule;
          }) ?? [],
    };
  });

  return defs;
}

export async function featureUpdated(feature: FeatureInterface) {
  // fire the webhook:
  await queueWebhook(feature.organization);
}
