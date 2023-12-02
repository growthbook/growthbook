import {
  AutoExperimentWithProject,
  FeatureDefinitionWithProject,
} from "back-end/types/api";
import pick from "lodash/pick";
import { SDKCapability } from "./index";

const strictFeatureKeys = ["defaultValue", "rules"];
const strictFeatureRuleKeys = [
  "id",
  "condition",
  "force",
  "variations",
  "weights",
  "key",
  "hashAttribute",
  "hashVersion",
  "range",
  "coverage",
  "namespace",
  "ranges",
  "meta",
  "filters",
  "seed",
  "name",
  "phase",
  "tracks",
];
const strictExperimentKeys = [
  "key",
  "variations",
  "ranges",
  "meta",
  "filters",
  "seed",
  "name",
  "phase",
  "urlPatterns",
  "weights",
  "condition",
  "coverage",
  "include",
  "namespace",
  "force",
  "hashAttribute",
  "hashVersion",
  "active",
  "status",
  "url",
  "groups",
];

export const scrubFeatures = (
  features: Record<string, FeatureDefinitionWithProject>,
  capabilities: SDKCapability[]
): Record<string, FeatureDefinitionWithProject> => {
  for (const k in features) {
    if (!capabilities.includes("looseUnmarshalling")) {
      features[k] = pick(
        features[k],
        strictFeatureKeys
      ) as FeatureDefinitionWithProject;
    }
    if (features[k]?.rules) {
      features[k].rules = features[k].rules?.map((rule) => {
        if (!capabilities.includes("looseUnmarshalling")) {
          rule = {
            ...pick(rule, strictFeatureRuleKeys),
          };
        }
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
  for (let i = 0; i < experiments.length; i++) {
    if (!capabilities.includes("looseUnmarshalling")) {
      experiments[i] = pick(
        experiments[i],
        strictExperimentKeys
      ) as AutoExperimentWithProject;
    }
  }

  return experiments;
};
