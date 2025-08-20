import {
  AutoExperimentWithProject,
  FeatureDefinition,
  FeatureDefinitionWithProject,
  FeatureDefinitionWithProjects,
} from "back-end/types/api";
import { pick, omit } from "lodash";
import cloneDeep from "lodash/cloneDeep";
import { getAutoExperimentChangeType } from "@growthbook/growthbook";
import { OrganizationInterface } from "back-end/types/organization";
import { SavedGroupsValues, SavedGroupInterface } from "../types";
import {
  getSavedGroupValueType,
  getTypedSavedGroupValues,
  NodeHandler,
  recursiveWalk,
} from "../util";
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

const savedGroupOperatorReplacements = {
  $inGroup: "$in",
  $notInGroup: "$nin",
};

export const scrubFeatures = (
  features: Record<string, FeatureDefinitionWithProject>,
  capabilities: SDKCapability[],
  savedGroups: SavedGroupInterface[],
  savedGroupReferencesEnabled: boolean,
  organization: OrganizationInterface,
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
  if (
    !capabilities.includes("savedGroupReferences") ||
    !savedGroupReferencesEnabled
  ) {
    const savedGroupsMap = Object.fromEntries(
      savedGroups.map((group) => [group.id, group]),
    );
    Object.values(features).forEach((feature) => {
      if (!feature.rules) {
        return;
      }
      feature.rules.forEach((rule) => {
        recursiveWalk(
          rule.condition,
          replaceSavedGroups(savedGroupsMap, organization),
        );
        recursiveWalk(
          rule.parentConditions,
          replaceSavedGroups(savedGroupsMap, organization),
        );
      });
    });
  }

  const newFeatures = cloneDeep(features);

  // Remove features that have any gating parentConditions & any rules that have parentConditions
  // Note: Reduction of features and rules is already performed in the back-end
  //   see: reduceFeaturesWithPrerequisites()
  if (!capabilities.includes("prerequisites")) {
    for (const k in newFeatures) {
      // delete feature
      if (
        newFeatures[k]?.rules?.some((rule) =>
          rule?.parentConditions?.some((pc) => !!pc.gate),
        )
      ) {
        delete newFeatures[k];
        continue;
      }
      // delete rules
      newFeatures[k].rules = newFeatures[k].rules?.filter(
        (rule) => (rule.parentConditions?.length ?? 0) === 0,
      );
    }
  }

  if (capabilities.includes("looseUnmarshalling")) {
    return newFeatures;
  }

  for (const k in newFeatures) {
    newFeatures[k] = pick(
      newFeatures[k],
      allowedFeatureKeys,
    ) as FeatureDefinitionWithProject;
    if (newFeatures[k]?.rules) {
      newFeatures[k].rules = newFeatures[k].rules?.map((rule) => {
        rule = {
          ...pick(rule, allowedFeatureRuleKeys),
        };
        return rule;
      });
    }
  }

  return newFeatures;
};

export const scrubExperiments = (
  experiments: AutoExperimentWithProject[],
  capabilities: SDKCapability[],
  savedGroups: SavedGroupInterface[],
  savedGroupReferencesEnabled: boolean,
  organization: OrganizationInterface,
): AutoExperimentWithProject[] => {
  const removedExperimentKeys: string[] = [];
  const supportsPrerequisites = capabilities.includes("prerequisites");
  const supportsRedirects = capabilities.includes("redirects");

  if (
    !capabilities.includes("savedGroupReferences") ||
    !savedGroupReferencesEnabled
  ) {
    const savedGroupsMap = Object.fromEntries(
      savedGroups.map((group) => [group.id, group]),
    );
    experiments.forEach((experimentDefinition) => {
      recursiveWalk(
        experimentDefinition.condition,
        replaceSavedGroups(savedGroupsMap, organization),
      );
      recursiveWalk(
        experimentDefinition.parentConditions,
        replaceSavedGroups(savedGroupsMap, organization),
      );
    });
  }

  if (supportsPrerequisites && supportsRedirects) return experiments;

  if (!supportsPrerequisites) {
    removedExperimentKeys.push(...prerequisiteKeys);
  }

  const newExperiments: AutoExperimentWithProject[] = [];

  for (let experiment of experiments) {
    // Filter out any url redirect auto experiments if not supported
    if (
      !supportsRedirects &&
      getAutoExperimentChangeType(experiment) === "redirect"
    ) {
      continue;
    }

    // Filter out experiments that have any parentConditions
    if (
      !supportsPrerequisites &&
      (experiment.parentConditions?.length ?? 0) > 0
    ) {
      continue;
    }

    // Scrub fields from the experiment
    experiment = omit(
      experiment,
      removedExperimentKeys,
    ) as AutoExperimentWithProject;

    newExperiments.push(experiment);
  }
  return newExperiments;
};

export const scrubSavedGroups = (
  savedGroupsValues: SavedGroupsValues,
  capabilities: SDKCapability[],
  savedGroupReferencesEnabled: boolean,
): SavedGroupsValues | undefined => {
  if (
    !capabilities.includes("savedGroupReferences") ||
    !savedGroupReferencesEnabled
  ) {
    return undefined;
  }
  return savedGroupsValues;
};

// Returns a handler which modifies the object in place, replacing saved group IDs with the contents of those groups
const replaceSavedGroups: (
  savedGroups: Record<string, SavedGroupInterface>,
  organization: OrganizationInterface,
) => NodeHandler = (
  savedGroups: Record<string, SavedGroupInterface>,
  organization,
) => {
  return ([key, value], object) => {
    if (key === "$inGroup" || key === "$notInGroup") {
      const group = savedGroups[value];

      const values = group
        ? getTypedSavedGroupValues(
            group.values || [],
            getSavedGroupValueType(group, organization),
          )
        : [];
      object[savedGroupOperatorReplacements[key]] = values;

      delete object[key];
    }
  };
};

export const scrubHoldouts = ({
  holdouts,
  projects,
  features,
}: {
  holdouts: Record<string, FeatureDefinitionWithProjects>;
  projects: string[];
  features: Record<string, FeatureDefinition>;
}): {
  holdouts: Record<string, FeatureDefinition>;
  features: Record<string, FeatureDefinition>;
} => {
  // Filter list of holdouts to the selected projects
  if (projects && projects.length > 0) {
    holdouts = Object.fromEntries(
      Object.entries(holdouts).filter(([_, holdout]) => {
        // If the holdout has no projects, it's a part of all projects and we want to include it
        if (!holdout.projects || holdout.projects.length === 0) {
          return true;
        }
        const holdoutProjects = holdout.projects;
        return projects.some((p) => holdoutProjects.includes(p));
      }),
    );
  }

  const holdoutIds = new Set(Object.keys(holdouts));

  // keep track of references to each holdoutId in the loop below
  const holdoutReferences = new Set<string>();

  // Filter out holdout pre-requisite rules that do not have associated holdout feature definitions
  // Also scrub holdoutId from all rules that have it
  for (const k in features) {
    if (features[k]?.rules) {
      features[k].rules = features[k].rules?.filter((rule) => {
        // If the rule id does not have the prefix "holdout_", it's not a holdout rule. Do not filter it out
        if (rule.id && !rule.id.startsWith("holdout_")) {
          return true;
        }

        // If the rule id has the prefix "holdout_", it's a holdout rule. Filter it out if it does not have an associated holdout feature definition
        if (rule.id && rule.id.startsWith("holdout_")) {
          // A holdout rule must have a parent condition because it's a prerequisite rule
          if (!rule.parentConditions || rule.parentConditions.length === 0) {
            return false;
          }

          const holdoutId = rule.parentConditions[0].id;
          if (!holdoutIds.has(holdoutId)) {
            return false;
          }
          // Document that this holdoutId is referenced by a feature rule
          holdoutReferences.add(holdoutId);
        }

        return true;
      });
    }
  }

  // Remove holdouts that are not referenced by any feature rules
  holdouts = Object.fromEntries(
    Object.entries(holdouts).filter(([key, _]) => {
      return holdoutReferences.has(key);
    }),
  );

  // Remove `projects` from holdouts
  holdouts = Object.fromEntries(
    Object.entries(holdouts).map(([key, holdout]) => [
      key,
      omit(holdout, ["projects"]),
    ]),
  );

  return { holdouts, features };
};
