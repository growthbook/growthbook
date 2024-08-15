import { OrganizationInterface } from "back-end/types/organization";
import { AttributeMap } from "back-end/src/services/features";
import { GroupMap, SavedGroupsValues, SavedGroupInterface } from "../types";

export const SMALL_GROUP_SIZE_LIMIT = 100;
export const LARGE_GROUP_SIZE_LIMIT_BYTES = 1024 * 1024;

export function getSavedGroupsValuesFromGroupMap(
  groupMap: GroupMap
): SavedGroupsValues {
  return Object.fromEntries(
    Array.from(groupMap.entries())
      .filter(
        ([_id, groupMapVal]) =>
          groupMapVal.type === "list" && groupMapVal.values !== undefined
      )
      .map(([id, groupMapVal]) => [id, groupMapVal.values])
    // TODO: maybe fix type inference
  ) as SavedGroupsValues;
}

export function getSavedGroupsValuesFromInterfaces(
  savedGroups: SavedGroupInterface[],
  organization: OrganizationInterface
): SavedGroupsValues {
  return Object.fromEntries(
    savedGroups
      .filter(
        (savedGroup) =>
          savedGroup.type === "list" && savedGroup.values !== undefined
      )
      .map((savedGroup) => {
        const values = getTypedSavedGroupValues(
          savedGroup.values || [],
          getSavedGroupValueType(savedGroup, organization)
        );
        return [savedGroup.id, values];
      })
    // TODO: maybe fix type inference
  ) as SavedGroupsValues;
}

export function getTypedSavedGroupValues(
  values: string[],
  type?: string
): string[] | number[] {
  if (type === "number") {
    return values.map((v) => parseFloat(v));
  }
  return values;
}

export function getSavedGroupValueType(
  group: SavedGroupInterface,
  organization: OrganizationInterface
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
