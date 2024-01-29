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
const stickyBucketingKeys = [
  "fallbackAttribute",
  "disableStickyBucketing",
  "bucketVersion",
  "minBucketVersion",
];
const prerequisiteKeys = ["parentConditions"];

export const scrubFeatures = (
  features: Record<string, FeatureDefinitionWithProject>,
  capabilities: SDKCapability[]
): Record<string, FeatureDefinitionWithProject> => {
  const allowedFeatureKeys = [...strictFeatureKeys];
  const allowedFeatureRuleKeys = [...strictFeatureRuleKeys];
  if (capabilities.includes("bucketingV2")) {
    allowedFeatureRuleKeys.push(...bucketingV2Keys);
  }
  if (capabilities.includes("stickyBucketing")) {
    allowedFeatureRuleKeys.push(...stickyBucketingKeys);
  }
  if (capabilities.includes("prerequisites")) {
    allowedFeatureRuleKeys.push(...prerequisiteKeys);
  }

  // Remove features that have any gating parentConditions & any rules that have parentConditions
  // "always off" features are already removed irrespective of capabilities.
  if (!capabilities.includes("prerequisites")) {
    for (const k in features) {
      // delete feature
      if (
        features[k]?.rules?.some((rule) =>
          rule?.parentConditions?.some((pc) => !!pc.gate)
        )
      ) {
        delete features[k];
        continue;
      }
      // delete rules
      features[k].rules = features[k].rules?.map((rule) => {
        rule = {
          ...pick(rule, allowedFeatureRuleKeys),
        };
        return rule;
      });
    }
  }

  if (capabilities.includes("looseUnmarshalling")) {
    return features;
  }

  features = { ...features };

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
  if (!capabilities.includes("prerequisites")) {
    const newExperiments: AutoExperimentWithProject[] = [];
    // Keep experiments that do not have any parentConditions
    for (const experiment of experiments) {
      if (!("parentConditions" in experiment)) {
        newExperiments.push(experiment);
      }
    }
    return newExperiments;
  }
  return experiments;
};
