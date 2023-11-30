import {
  AutoExperimentWithProject,
  FeatureDefinitionWithProject,
} from "back-end/types/api";
import omit from "lodash/omit";
import { SDKCapability } from "./index";

const looseUnmarshallingKeys = [
  "fallbackAttribute",
  "disableStickyBucketing",
  "bucketVersion",
  "minBucketVersion",
  "blockedVariations",
];

export const scrubFeatures = (
  features: Record<string, FeatureDefinitionWithProject>,
  capabilities: SDKCapability[]
): Record<string, FeatureDefinitionWithProject> => {
  for (const k in features) {
    if (features[k]?.rules) {
      features[k].rules = features[k].rules?.map((rule) => {
        if (!capabilities.includes("loose-unmarshalling")) {
          rule = {
            ...omit(rule, looseUnmarshallingKeys),
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
    let exp = experiments[i];
    if (!capabilities.includes("loose-unmarshalling")) {
      exp = omit(exp, looseUnmarshallingKeys) as AutoExperimentWithProject;
    }
    experiments[i] = exp;
  }

  return experiments;
};
