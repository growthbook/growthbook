import { FeatureDefinitionRule, FeatureDefinition } from "../../types/api";
import { FeatureInterface, FeatureValueType } from "../../types/feature";
import { queueCDNInvalidate } from "../jobs/cacheInvalidate";
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
              rule.condition = JSON.parse(r.condition);
            }

            if (r.type === "force") {
              rule.force = getJSONValue(feature.valueType, r.value);
            } else if (r.type === "rollout") {
              rule.variations = r.values.map((v) =>
                getJSONValue(feature.valueType, v.value)
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

  // invalidate the CDN
  await queueCDNInvalidate(
    feature.organization,
    (key) => `/api/features/${key}`
  );
}
