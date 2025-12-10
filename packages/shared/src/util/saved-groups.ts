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
import { replaceSavedGroups } from "../sdk-versioning";
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
  organization: Pick<OrganizationInterface, "settings">,
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
  condition: string | undefined | null,
  savedGroups: Record<string, SavedGroupInterface>,
): [boolean, string | null] {
  if (!condition) return [false, null];

  try {
    const parsed = JSON.parse(condition);
    recursiveWalk(parsed, replaceSavedGroups(savedGroups, {}));

    const stringified = JSON.stringify(parsed);
    const matches = stringified.match(/"__sgCycle__"\s*:\s*"([^"]*)"/);

    if (matches) {
      return [true, matches[1] || null];
    }

    const maxDepthMatches = stringified.match(/"__sgMaxDepth__"\s*:/);
    if (maxDepthMatches) {
      return [true, null];
    }
  } catch (e) {
    // If condition is invalid JSON, we can't determine if it's cyclic
    return [false, null];
  }

  return [false, null];
}
