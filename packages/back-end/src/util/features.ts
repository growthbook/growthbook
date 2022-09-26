import { GroupMap } from "../services/features";

export function replaceSavedGroupsInCondition(
  condition: string,
  groupMap: GroupMap
) {
  const newString = condition
    .replace(
      // Ex: replace { $inGroup: "sdf8sd9f87s0dfs09d8" } with { $in: ["123, 345, 678, 910"]}
      /"\$inGroup"[\s|\n]*:[\s|\n]*"([^"]*)"/g,
      (match: string, groupId: string) => {
        const ids: string[] | number[] = groupMap.get(groupId) ?? [];
        return `"$in": ${JSON.stringify(ids)}`;
      }
    )
    .replace(
      // Ex: replace { $notInGroup: "sdf8sd9f87s0dfs09d8" } with { $nin: ["123, 345, 678, 910"]}
      /"\$notInGroup"[\s|\n]*:[\s|\n]*"([^"]*)"/g,
      (match: string, groupId: string) => {
        const ids: string[] | number[] = groupMap.get(groupId) ?? [];
        return `"$nin": ${JSON.stringify(ids)}`;
      }
    );

  return newString;
}
