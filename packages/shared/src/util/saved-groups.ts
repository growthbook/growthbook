import {
  SDKAttributeType,
  OrganizationInterface,
  SDKAttribute,
} from "back-end/types/organization";
import { AttributeMap } from "back-end/types/feature";
import {
  GroupMap,
  SavedGroupsValues,
  SavedGroupInterface,
} from "shared/types/groups";
import { recursiveWalk } from "./index";

export const SAVED_GROUP_SIZE_LIMIT_BYTES = 1024 * 1024;
export const SMALL_GROUP_SIZE_LIMIT = 100;
export const ID_LIST_DATATYPES: SDKAttributeType[] = [
  "number",
  "string",
  "secureString",
] as const;
export function isIdListSupportedAttribute(
  attribute?: Pick<SDKAttribute, "datatype" | "disableEqualityConditions">,
): boolean {
  if (attribute?.disableEqualityConditions) return false;
  const datatype = attribute?.datatype;
  return !!datatype && ID_LIST_DATATYPES.includes(datatype);
}

export function getSavedGroupsValuesFromGroupMap(
  groupMap: GroupMap,
): SavedGroupsValues {
  return Object.fromEntries(
    Array.from(groupMap.entries())
      .filter(
        ([_id, groupMapVal]) =>
          groupMapVal.type === "list" && groupMapVal.values !== undefined,
      )
      .map(([id, groupMapVal]) => [id, groupMapVal.values]),
    // TODO: maybe fix type inference
  ) as SavedGroupsValues;
}

export function getSavedGroupsValuesFromInterfaces(
  savedGroups: SavedGroupInterface[],
  organization: OrganizationInterface,
): SavedGroupsValues {
  return Object.fromEntries(
    savedGroups
      .filter(
        (savedGroup) =>
          savedGroup.type === "list" && savedGroup.values !== undefined,
      )
      .map((savedGroup) => {
        const values = getTypedSavedGroupValues(
          savedGroup.values || [],
          getSavedGroupValueType(savedGroup, organization),
        );
        return [savedGroup.id, values];
      }),
    // TODO: maybe fix type inference
  ) as SavedGroupsValues;
}

export function getTypedSavedGroupValues(
  values: string[],
  type?: string,
): string[] | number[] {
  if (type === "number") {
    return values.map((v) => parseFloat(v));
  }
  return values;
}

export function getSavedGroupValueType(
  group: SavedGroupInterface,
  organization: OrganizationInterface,
): string {
  const attributes = organization.settings?.attributeSchema;

  const attributeMap: AttributeMap = new Map();
  attributes?.forEach((attribute) => {
    attributeMap.set(attribute.property, attribute.datatype);
  });

  if (group.type === "list" && group.attributeKey && group.values) {
    const attributeType = attributeMap?.get(group.attributeKey);
    return attributeType || "";
  }

  return "";
}

/**
 * Extract all saved group IDs referenced in a condition (via $inGroup or $notInGroup)
 */
export function extractSavedGroupReferences(
  condition: string | undefined | null,
): string[] {
  if (!condition) return [];
  try {
    const parsed = JSON.parse(condition);
    const referencedIds = new Set<string>();
    recursiveWalk(parsed, (node) => {
      if (node[0] === "$inGroup" || node[0] === "$notInGroup") {
        referencedIds.add(node[1]);
      }
    });
    return Array.from(referencedIds);
  } catch (e) {
    return [];
  }
}

/**
 * Check if a saved group creates a circular reference.
 * Returns [isCyclic, cyclicGroupId]
 * Similar to isFeatureCyclic for prerequisites.
 * 
 * @param groupId - The ID of the group being created/updated (optional for new groups)
 * @param condition - The condition string to check
 * @param groupMap - Map of all existing saved groups
 * @param excludeGroupId - For updates, exclude this group from cycle check
 * @param savedGroups - Optional savedGroups targeting array to check
 */
export function isSavedGroupCyclic(
  groupId: string | undefined,
  condition: string | undefined | null,
  groupMap: GroupMap | Map<string, SavedGroupInterface>,
  excludeGroupId?: string, // For updates, exclude the current group from cycle check
  savedGroups?: Array<{ ids: string[] }>, // SavedGroupTargeting array
): [boolean, string | null] {
  const visited = new Set<string>();
  const stack = new Set<string>();

  const visit = (currentGroupId: string): [boolean, string | null] => {
    // If we're back to a group in the current path, we have a cycle
    if (stack.has(currentGroupId)) {
      return [true, currentGroupId];
    }
    // If we've already visited this group (but not in current path), no cycle
    if (visited.has(currentGroupId)) {
      return [false, null];
    }

    // Skip the excluded group (for updates)
    if (currentGroupId === excludeGroupId) {
      return [false, null];
    }

    const group = groupMap.get(currentGroupId);
    if (!group || group.type !== "condition") {
      return [false, null];
    }

    stack.add(currentGroupId);
    visited.add(currentGroupId);

    // Extract referenced groups from this group's condition
    const referencedIds = extractSavedGroupReferences(group.condition);

    // Also extract from savedGroups field if it exists
    if (group.savedGroups) {
      group.savedGroups.forEach((sg) => {
        referencedIds.push(...sg.ids);
      });
    }

    // Recursively check each referenced group
    for (const refId of referencedIds) {
      const [isCyclic, cyclicId] = visit(refId);
      if (isCyclic) {
        stack.delete(currentGroupId);
        return [true, cyclicId || currentGroupId];
      }
    }

    stack.delete(currentGroupId);
    return [false, null];
  };

  // Check if the new condition creates a cycle
  const referencedIds = new Set<string>();
  
  // Extract from condition
  extractSavedGroupReferences(condition).forEach((id) => referencedIds.add(id));
  
  // Extract from savedGroups parameter
  if (savedGroups) {
    savedGroups.forEach((sg) => {
      sg.ids.forEach((id) => referencedIds.add(id));
    });
  }

  for (const refId of referencedIds) {
    const [isCyclic, cyclicId] = visit(refId);
    if (isCyclic) {
      return [true, cyclicId || refId];
    }
  }

  return [false, null];
}
