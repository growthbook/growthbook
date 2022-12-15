import { ScheduleRule } from "../../types/feature";

export const getCurrentEnabledState = (
  scheduleRules: ScheduleRule[],
  currentDate: Date
) => {
  //Filter our rules that have schedulingRules if the current scheduleRule sets the feature to disabled.
  if (!scheduleRules.length) {
    return true;
  }

  // Loop through the list of rules, and find the next rule to be applied
  const nextRuleIndex = scheduleRules.findIndex(
    (rule) => rule.timestamp !== null && new Date(rule.timestamp) > currentDate
  );

  if (nextRuleIndex === -1) {
    if (scheduleRules.at(-1)?.timestamp === null) {
      return true;
    } else {
      return scheduleRules.at(-1)?.enableFeature;
    }
  }

  return !scheduleRules[nextRuleIndex].enableFeature;
};
