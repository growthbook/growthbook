import { FeatureDefinitionRule, FeatureDefinition } from "../../types/api";
import { FeatureInterface, FeatureValueType } from "../../types/feature";
import { queueWebhook } from "../jobs/webhooks";
import { getAllFeatures } from "../models/FeatureModel";

function roundVariationWeight(num: number): number {
  return Math.round(num * 1000) / 1000;
}
function getTotalVariationWeight(weights: number[]): number {
  return roundVariationWeight(weights.reduce((sum, w) => sum + w, 0));
}
// Adjusts an array of weights so it always sums to exactly 1
function adjustWeights(weights: number[]): number[] {
  const diff = getTotalVariationWeight(weights) - 1;
  const nDiffs = Math.round(Math.abs(diff) * 1000);
  return weights.map((v, i) => {
    const j = weights.length - i - 1;
    let d = 0;
    if (diff < 0 && i < nDiffs) d = 0.001;
    else if (diff > 0 && j < nDiffs) d = -0.001;
    return +(v + d).toFixed(3);
  });
}

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
  environment?: string,
  project?: string
) {
  const features = await getAllFeatures(organization, project);

  const defs: Record<string, FeatureDefinition> = {};
  features.forEach((feature) => {
    if (environment && !feature.environments?.includes(environment)) {
      defs[feature.id] = { defaultValue: null };
      return;
    }

    defs[feature.id] = {
      defaultValue: getJSONValue(feature.valueType, feature.defaultValue),
      rules:
        feature.rules
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
                .map((w) => (w < 0 ? 0 : w > 1 ? 1 : w))
                .map((w) => roundVariationWeight(w));
              const totalWeight = getTotalVariationWeight(weights);
              if (totalWeight <= 0) {
                rule.coverage = 0;
              } else if (totalWeight < 0.999) {
                rule.coverage = totalWeight;
              }

              const multiplier = totalWeight > 0 ? 1 / totalWeight : 0;
              rule.weights = adjustWeights(
                weights.map((w) => roundVariationWeight(w * multiplier))
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

export async function featureUpdated(
  feature: FeatureInterface,
  previousEnvironments: string[] = [],
  previousProject: string = ""
) {
  // fire the webhook:
  await queueWebhook(
    feature.organization,
    [...feature.environments, ...previousEnvironments],
    [previousProject || "", feature.project || ""],
    true
  );
}
