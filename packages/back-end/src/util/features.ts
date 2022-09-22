import { SavedGroupInterface } from "../../types/saved-group";
import { GroupMap, AttributeMap } from "../services/features";

function getAttributeType(
  allGroups: SavedGroupInterface[] | [],
  groupId: string,
  attributeMap: AttributeMap
) {
  const index = allGroups?.findIndex(
    (group: SavedGroupInterface) => group.id === groupId
  );

  if (index === -1) {
    return null;
  }

  const attribute = allGroups[index].attributeKey;

  const type: string | undefined = attributeMap?.get(attribute);

  return type;
}

export function replaceSavedGroupsInCondition(
  condition: string,
  groupMap: GroupMap,
  allGroups: SavedGroupInterface[] | [],
  attributeMap: AttributeMap
) {
  const newString = condition
    .replace(
      // Ex: replace { $inGroup: "sdf8sd9f87s0dfs09d8" } with { $in: ["123, 345, 678, 910"]}
      /"\$inGroup"[\s|\n]*:[\s|\n]*"([^"]*)"/g,
      (match: string, groupId: string) => {
        const type = getAttributeType(allGroups, groupId, attributeMap);
        let ids: string[] | number[] = groupMap.get(groupId) ?? [];
        if (type && type === "number") {
          ids = ids.map((id) => parseFloat(id));
        }
        return `"$in": ${JSON.stringify(ids)}`;
      }
    )
    .replace(
      // Ex: replace { $notInGroup: "sdf8sd9f87s0dfs09d8" } with { $nin: ["123, 345, 678, 910"]}
      /"\$notInGroup"[\s|\n]*:[\s|\n]*"([^"]*)"/g,
      (match: string, groupId: string) => {
        const type = getAttributeType(allGroups, groupId, attributeMap);
        let ids: string[] | number[] = groupMap.get(groupId) ?? [];
        if (type && type === "number") {
          ids = ids.map((id) => parseFloat(id));
        }
        return `"$nin": ${JSON.stringify(ids)}`;
      }
    );

  return newString;
}
