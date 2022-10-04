import { GroupMap } from "../services/features";

export function replaceSavedGroupsInCondition(
  condition: string,
  groupMap: GroupMap
) {
  const newString = condition.replace(
    // Ex: replace { $inGroup: "sdf8sd9f87s0dfs09d8" } with { $in: ["123, 345, 678, 910"]}
    /[\s|\n]*"\$(inGroup|notInGroup)"[\s|\n]*:[\s|\n]*"([^"]*)"[\s|\n]*/g,
    (match: string, operator: string, groupId: string) => {
      const newOperator = operator === "inGroup" ? "$in" : "$nin";
      const ids: string[] | number[] = groupMap.get(groupId) ?? [];
      return `"${newOperator}": ${JSON.stringify(ids)}`;
    }
  );

  return newString;
}
