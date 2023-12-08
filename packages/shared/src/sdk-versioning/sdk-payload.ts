import {
  AutoExperimentWithProject,
  FeatureDefinitionWithProject,
} from "back-end/types/api";
import pick from "lodash/pick";
import { SDKCapability } from "./index";

const strictFeatureKeys = ["defaultValue", "rules"];
const strictFeatureRuleKeys = [
  "key",
  "variations",
  "weights",
  "coverage",
  "condition",
  "namespace",
  "force",
  "hashAttribute",
];
const strictExperimentKeys = [
  "key",
  "variations",
  "weights",
  "active",
  "status",
  "coverage",
  "condition",
  "namespace",
  "url",
  "include",
  "groups",
  "force",
  "hashAttribute",
];
const bucketingV2Keys = [
  "hashVersion",
  "range",
  "ranges",
  "meta",
  "filters",
  "seed",
  "name",
  "phase",
];

export const scrubFeatures = (
  features: Record<string, FeatureDefinitionWithProject>,
  capabilities: SDKCapability[]
): Record<string, FeatureDefinitionWithProject> => {
  if (capabilities.includes("looseUnmarshalling")) {
    return features;
  }

  features = { ...features };
  const allowedFeatureKeys = [...strictFeatureKeys];
  const allowedFeatureRuleKeys = [...strictFeatureRuleKeys];
  if (capabilities.includes("bucketingV2")) {
    allowedFeatureRuleKeys.push(...bucketingV2Keys);
  }

  for (const k in features) {
    features[k] = pick(
      features[k],
      allowedFeatureKeys
    ) as FeatureDefinitionWithProject;
    if (features[k]?.rules) {
      features[k].rules = features[k].rules?.map((rule) => {
        rule = {
          ...pick(rule, allowedFeatureRuleKeys),
        };
        return rule;
      });
    }
  }

  return features;
};

export const scrubExperiments = (
  experiments: AutoExperimentWithProject[],
  capabilities: SDKCapability[]
): AutoExperimentWithProject[] => {
  if (capabilities.includes("looseUnmarshalling")) {
    return experiments;
  }

  experiments = [...experiments];
  const allowedExperimentKeys = [...strictExperimentKeys];
  if (capabilities.includes("bucketingV2")) {
    allowedExperimentKeys.push(...bucketingV2Keys);
  }

  for (let i = 0; i < experiments.length; i++) {
    experiments[i] = pick(
      experiments[i],
      allowedExperimentKeys
    ) as AutoExperimentWithProject;
  }

  return experiments;
};
