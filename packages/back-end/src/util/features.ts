import { GroupMap } from "../services/features";

export function replaceSavedGroupsInCondition(
  condition: string,
  groupMap: GroupMap
) {
  const newString = condition
    .replace(
      /"\$inGroup"[\s|\n]*:[\s|\n]*"([^"]*)"/g,
      (match: string, groupId: string) => {
        const ids: string[] = groupMap.get(groupId) ?? [];
        return `"in": ${JSON.stringify(ids)}`;
      }
    )
    .replace(
      /"\$notInGroup"[\s|\n]*:[\s|\n]*"([^"]*)"/g,
      (match: string, groupId: string) => {
        const ids: string[] = groupMap.get(groupId) ?? [];
        return `"nin": ${JSON.stringify(ids)}`;
      }
    );

  return newString;
}
