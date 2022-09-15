import { GroupMap } from "../services/features";

export function replaceSavedGroupsInCondition(
  condition: string,
  groupMap: GroupMap
) {
  return condition.replace(
    /"$inGroup"[\s|\n]*:[\s|\n]*"([^"]*)"/g,
    (match: string, groupId: string) => {
      console.log("Got in here");
      const ids: string[] = groupMap.get(groupId) ?? [];
      return `in:${JSON.stringify(ids)}`;
    }
  );
}
