import { OrganizationInterface } from "shared/types/organization";
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
import { SDKCapability } from "./types";

// Base feature keys
export const STRICT_FEATURE_KEYS = ["defaultValue", "rules"] as const;

// Base feature rule keys
export const STRICT_FEATURE_RULE_KEYS = [
  "key",
  "variations",
  "weights",
  "coverage",
  "condition",
  "namespace",
  "force",
  "hashAttribute",
] as const;

export const BUCKETING_V2_RULE_KEYS = [
  "hashVersion",
  "range",
  "ranges",
  "meta",
  "filters",
  "seed",
  "name",
  "phase",
] as const;

export const STICKY_BUCKETING_RULE_KEYS = [
  "fallbackAttribute",
  "disableStickyBucketing",
  "bucketVersion",
  "minBucketVersion",
] as const;

export const PREREQUISITE_RULE_KEYS = ["parentConditions"] as const;

export function getPayloadAllowedKeys(capabilities: SDKCapability[]): {
  featureKeys: readonly string[];
  featureRuleKeys: readonly string[];
  removedExperimentKeys: string[];
} {
  const featureRuleKeys = [
    ...STRICT_FEATURE_RULE_KEYS,
    ...(capabilities.includes("bucketingV2") ? BUCKETING_V2_RULE_KEYS : []),
    ...(capabilities.includes("stickyBucketing")
      ? STICKY_BUCKETING_RULE_KEYS
      : []),
    ...(capabilities.includes("prerequisites") ? PREREQUISITE_RULE_KEYS : []),
  ];
  const removedExperimentKeys = capabilities.includes("prerequisites")
    ? []
    : [...PREREQUISITE_RULE_KEYS];
  return {
    featureKeys: [...STRICT_FEATURE_KEYS],
    featureRuleKeys,
    removedExperimentKeys,
  };
}

const savedGroupOperatorReplacements = {
  $inGroup: "$in",
  $notInGroup: "$nin",
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
