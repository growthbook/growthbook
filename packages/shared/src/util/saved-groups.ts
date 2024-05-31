import { GroupMap, SavedGroupsValues, SavedGroupInterface } from "../types";

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
