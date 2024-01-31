import {
  AutoExperimentWithProject,
  FeatureDefinitionWithProject,
} from "back-end/types/api";
import { pick, omit } from "lodash";
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
  // Note: Reduction of features and rules is already performed in the back-end
  //   see: reduceFeaturesWithPrerequisites()
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
      features[k].rules = features[k].rules?.filter(
        (rule) => (rule.parentConditions?.length ?? 0) === 0
      );
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
  const removedExperimentKeys = [];
  if (!capabilities.includes("prerequisites")) {
    removedExperimentKeys.push(...prerequisiteKeys);
    const newExperiments: AutoExperimentWithProject[] = [];
    // Keep experiments that do not have any parentConditions
    for (let experiment of experiments) {
      if ((experiment.parentConditions?.length ?? 0) === 0) {
        // keep and scrub experiments
        experiment = omit(
          experiment,
          removedExperimentKeys
        ) as AutoExperimentWithProject;
        newExperiments.push(experiment);
      }
    }
    return newExperiments;
  }
  return experiments;
};
