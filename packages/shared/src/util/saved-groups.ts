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
  savedGroups: SavedGroupInterface[]
): SavedGroupsValues {
  return Object.fromEntries(
    savedGroups
      .filter(
        (savedGroup) =>
          savedGroup.type === "list" && savedGroup.values !== undefined
      )
      .map((savedGroup) => [savedGroup.id, savedGroup.values])
    // TODO: maybe fix type inference
  ) as SavedGroupsValues;
}
