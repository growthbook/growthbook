import { GroupMap, SavedGroupsValues, SavedGroupInterface } from "../types";

export const LEGACY_GROUP_SIZE_LIMIT = 100;

export function getSavedGroupsValuesFromGroupMap(
  groupMap: GroupMap
): SavedGroupsValues {
  return Object.fromEntries(
    Array.from(groupMap.entries())
      .filter(
        ([_id, groupMapVal]) =>
          groupMapVal.type === "list" &&
          groupMapVal.values !== undefined &&
          groupMapVal.passByReferenceOnly === true
      )
      .map(([id, groupMapVal]) => [id, groupMapVal.values])
    // TODO: maybe fix type inference
  ) as SavedGroupsValues;
}

export function getSavedGroupsValuesFromInterfaces(
  savedGroups: SavedGroupInterface[]
): SavedGroupsValues {
  return Object.fromEntries(
    savedGroups
      .filter(
        (savedGroup) =>
          savedGroup.type === "list" &&
          savedGroup.values !== undefined &&
          savedGroup.passByReferenceOnly === true
      )
      .map((savedGroup) => [savedGroup.id, savedGroup.values])
    // TODO: maybe fix type inference
  ) as SavedGroupsValues;
}
