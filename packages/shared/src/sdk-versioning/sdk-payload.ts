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
  "hashVersion",
  "range",
  "ranges",
  "meta",
  "filters",
  "seed",
  "name",
  "phase",
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
  "hashVersion",
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
