import { pick, omit } from "lodash";
import { getAutoExperimentChangeType } from "@growthbook/growthbook";
import { OrganizationInterface } from "shared/types/organization";
import {
  AutoExperimentWithProject,
  FeatureDefinition,
  FeatureDefinitionWithProject,
  FeatureDefinitionWithProjects,
} from "shared/types/sdk";
import {
  GroupMap,
  SavedGroupsValues,
  SavedGroupInterface,
} from "shared/types/saved-group";
import {
  getSavedGroupValueType,
  getTypedSavedGroupValues,
  NodeHandler,
  recursiveWalk,
} from "../util";
import { FeatureValueType } from "../validators";
import { SDKCapability } from "./types";

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

  // Remove features that have any gating parentConditions & any rules that have parentConditions
  // Note: Reduction of features and rules is already performed in the back-end
  //   see: reduceFeaturesWithPrerequisites()
  if (!capabilities.includes("prerequisites")) {
    for (const k in features) {
      // delete feature
      if (
        features[k]?.rules?.some((rule) =>
          rule?.parentConditions?.some((pc) => !!pc.gate),
        )
      ) {
        delete features[k];
        continue;
      }
      // delete rules
      features[k].rules = features[k].rules?.filter(
        (rule) => (rule.parentConditions?.length ?? 0) === 0,
      );
    }
  }

  if (capabilities.includes("looseUnmarshalling")) {
    return features;
  }

  for (const k in features) {
    features[k] = pick(
      features[k],
      allowedFeatureKeys,
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

// Maximum depth for recursive saved group resolution
const MAX_SAVED_GROUP_DEPTH = 10;

export const SAVED_GROUP_ERROR_MAX_DEPTH = "__sgMaxDepth__";
export const SAVED_GROUP_ERROR_CYCLE = "__sgCycle__";
export const SAVED_GROUP_ERROR_INVALID = "__sgInvalid__";
export const SAVED_GROUP_ERROR_UNKNOWN = "__sgUnknown__";

export function conditionHasSavedGroupErrors(
  condition: unknown,
  ignoreCycleErrors: boolean = false,
) {
  if (!condition) return false;

  const src =
    typeof condition === "object"
      ? JSON.stringify(condition)
      : String(condition);

  const errorMarkers = [
    SAVED_GROUP_ERROR_INVALID,
    ...(ignoreCycleErrors
      ? []
      : [
          SAVED_GROUP_ERROR_UNKNOWN,
          SAVED_GROUP_ERROR_MAX_DEPTH,
          SAVED_GROUP_ERROR_CYCLE,
        ]),
  ];

  if (errorMarkers.length === 0) return false;

  const regex = new RegExp(`"(${errorMarkers.join("|")})"\\s*:`);
  return !!src.match(regex);
}

export const expandNestedSavedGroups: (
  savedGroups: GroupMap,
  visited?: Set<string>,
  depth?: number,
) => NodeHandler = (savedGroups: GroupMap, visited = new Set(), depth = 0) => {
  return ([key, value], object) => {
    if (key !== "$savedGroups") return;

    delete object.$savedGroups;

    const newConditions: unknown[] = [];

    if (depth >= MAX_SAVED_GROUP_DEPTH) {
      // Gracefully truncate: replace with condition that is always false
      // This prevents infinite recursion and deep nesting issues
      newConditions.push({ [SAVED_GROUP_ERROR_MAX_DEPTH]: true });
    }

    const savedGroupValues = Array.isArray(value) ? value : [value];
    for (const groupId of savedGroupValues) {
      if (depth >= MAX_SAVED_GROUP_DEPTH) {
        // Prevent infinite recursion
        continue;
      }
      if (!groupId || typeof groupId !== "string") continue;

      // Prevent cycles
      if (visited.has(groupId)) {
        // Cycle detected - replace with always-false condition
        // Break out of the loop since the entire condition is already invalid
        newConditions.push({ [SAVED_GROUP_ERROR_CYCLE]: groupId });
        break;
      }

      const savedGroup = savedGroups.get(groupId);
      if (!savedGroup) {
        // Unknown group, replace with always-false condition
        newConditions.push({ [SAVED_GROUP_ERROR_UNKNOWN]: groupId });
        break;
      }

      // For ID List groups, create an [attributeKey]: { $inGroup: ... } targeting condition
      if (savedGroup.type === "list") {
        const attributeKey = savedGroup.attributeKey;
        if (!attributeKey) {
          // Missing attributeKey on a list group is effectively invalid
          newConditions.push({ [SAVED_GROUP_ERROR_INVALID]: groupId });
          break;
        }
        const cond: Record<string, unknown> = {
          [attributeKey]: { $inGroup: groupId },
        };
        newConditions.push(cond);
        continue;
      }

      const nestedCondition = savedGroup.condition;
      if (!nestedCondition || nestedCondition === "{}") {
        // An empty condition should always pass, so skip it
        continue;
      }

      try {
        const cond = JSON.parse(nestedCondition);

        const newVisited = new Set(visited);
        newVisited.add(groupId);

        // Recursively resolve nested $savedGroups in this condition
        // Pass depth + 1 to track nesting level
        recursiveWalk(
          cond,
          expandNestedSavedGroups(savedGroups, newVisited, depth + 1),
        );

        if (cond && Object.keys(cond).length > 0) {
          newConditions.push(cond);
        }
      } catch (e) {
        // JSON parse error, replace with always-false condition
        newConditions.push({ [SAVED_GROUP_ERROR_INVALID]: groupId });
        break;
      }
    }

    // If nothing to add, return early
    if (!newConditions.length) return;

    // Combine existing condition with new conditions using AND
    const and: unknown[] = [];

    // Add existing conditions (if any) to a new object within $and
    const existingCond: Record<string, unknown> = {};
    for (const k in object) {
      // Existing $and - flatten into the new $and array
      if (k === "$and") {
        // Valid $and - array of condition
        if (Array.isArray(object["$and"])) {
          object["$and"].forEach((cond: unknown) => {
            and.push(cond);
          });
        }
        // Invalid $and - not an array, keep as-is
        else {
          and.push({ $and: object["$and"] });
        }
      }
      // Otherwise, add to existingCond
      else {
        existingCond[k] = object[k];
      }
    }
    if (Object.keys(existingCond).length > 0) {
      and.push(existingCond);
    }

    // Add all new conditions from saved groups
    newConditions.forEach((cond) => {
      // Sanity check - this should never be false
      if (cond && typeof cond === "object") {
        and.push(cond);
      }
    });

    // Remove invalid entries and flatten into final AND
    const finalAnd: Record<string, unknown>[] = [];
    and.forEach((cond: unknown) => {
      // Skip conditions that are not objects or empty
      if (!cond || typeof cond !== "object" || Object.keys(cond).length === 0) {
        return;
      }

      // Object with a single key "$and"
      // Flatten into top-level $and
      if (
        Object.keys(cond).length === 1 &&
        "$and" in cond &&
        Array.isArray(cond["$and"])
      ) {
        cond["$and"].forEach((nestedCond: unknown) => {
          if (
            nestedCond &&
            typeof nestedCond === "object" &&
            Object.keys(nestedCond).length > 0
          ) {
            finalAnd.push(nestedCond as Record<string, unknown>);
          }
        });
      }
      // Otherwise, keep the condition as-is
      else {
        finalAnd.push(cond as Record<string, unknown>);
      }
    });

    // Remove all existing keys from object
    for (const k in object) {
      delete object[k];
    }

    // If $and has only one condition, flatten it and add each key directly
    if (finalAnd.length === 1) {
      const singleCond = finalAnd[0];
      for (const k in singleCond) {
        object[k] = singleCond[k];
      }
    }
    // Otherwise set $and to the combined conditions
    else {
      object["$and"] = finalAnd;
    }
  };
};

// Returns a handler which modifies the object in place, replacing saved group IDs with the contents of those groups
export const replaceSavedGroups: (
  savedGroups: Record<string, SavedGroupInterface>,
  organization: Pick<OrganizationInterface, "settings">,
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getJSONValue(type: FeatureValueType, value: string): any {
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
