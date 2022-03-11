import { FeatureDefinitionRule, FeatureDefinition } from "../../types/api";
import {
  FeatureEnvironment,
  FeatureInterface,
  FeatureValueType,
} from "../../types/feature";
import { queueWebhook } from "../jobs/webhooks";
import { getAllFeatures } from "../models/FeatureModel";
import uniqid from "uniqid";

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
export async function getFeatureDefinitions(
  organization: string,
  environment: string = "production",
  project?: string
) {
  const features = await getAllFeatures(organization, project);

  const defs: Record<string, FeatureDefinition> = {};
  features.forEach((feature) => {
    const settings = feature.environmentSettings?.[environment];

    if (!settings || !settings.enabled) {
      defs[feature.id] = { defaultValue: null };
      return;
    }

    defs[feature.id] = {
      defaultValue: getJSONValue(
        feature.valueType,
        settings.defaultValue ?? feature.defaultValue
      ),
      rules:
        settings.rules
          ?.filter((r) => r.enabled)
          ?.map((r) => {
            const rule: FeatureDefinitionRule = {};
            if (r.condition && r.condition !== "{}") {
              try {
                rule.condition = JSON.parse(r.condition);
              } catch (e) {
                // ignore condition parse errors here
              }
            }

            if (r.type === "force") {
              rule.force = getJSONValue(feature.valueType, r.value);
            } else if (r.type === "experiment") {
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
            } else if (r.type === "rollout") {
              rule.force = getJSONValue(feature.valueType, r.value);
              rule.coverage =
                r.coverage > 1 ? 1 : r.coverage < 0 ? 0 : r.coverage;

              if (r.hashAttribute) {
                rule.hashAttribute = r.hashAttribute;
              }
            }
            return rule;
          }) ?? [],
    };
    if (defs[feature.id].rules && !defs[feature.id].rules?.length) {
      delete defs[feature.id].rules;
    }
  });

  return defs;
}

export function getEnabledEnvironments(feature: FeatureInterface) {
  return Object.keys(feature.environmentSettings ?? {}).filter((env) => {
    return !!feature.environmentSettings?.[env]?.enabled;
  });
}

export function addIdsToRules(
  environmentSettings: Record<string, FeatureEnvironment> = {},
  featureId: string
) {
  Object.values(environmentSettings).forEach((env) => {
    if (env.rules && env.rules.length) {
      env.rules.forEach((r) => {
        if (r.type === "experiment" && !r?.trackingKey) {
          r.trackingKey = featureId;
        }
        if (!r.id) {
          r.id = uniqid("fr_");
        }
      });
    }
  });
}

export async function featureUpdated(
  feature: FeatureInterface,
  previousEnvironments: string[] = [],
  previousProject: string = ""
) {
  const currentEnvironments = getEnabledEnvironments(feature);

  // fire the webhook:
  await queueWebhook(
    feature.organization,
    [...currentEnvironments, ...previousEnvironments],
    [previousProject || "", feature.project || ""],
    true
  );
}
