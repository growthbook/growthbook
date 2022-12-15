import { ScheduleRule } from "../../types/feature";

export const getCurrentEnabledState = (
  scheduleRules: ScheduleRule[],
  currentDate: Date
) => {
  // If a feature doesn't have any rules, don't filter it out
  if (!scheduleRules.length) {
    return true;
  }

  // Ensure the scheduleRules array is always sorted earliest to latest
  const sortedRules = scheduleRules.sort((a, b) => {
    let dateA;
    let dateB;
    if (a.timestamp === null) {
      dateA = a.enableFeature ? new Date("01-01-1971") : new Date("01-01-2090"); //TODO: Find a better way to handle this
    } else {
      dateA = new Date(a.timestamp);
    }

    if (b.timestamp === null) {
      dateB = b.enableFeature ? new Date("01-01-1971") : new Date("01-01-2090"); //TODO: Find a better way to handle this
    } else {
      dateB = new Date(b.timestamp);
    }

    return dateA.valueOf() - dateB.valueOf();
  });

  // Loop through the list of rules, and find the next rule to be applied
  // (aka, the first rule in the array where the timestamp is in the future)
  const nextRuleIndex = sortedRules.findIndex(
    (rule) => rule.timestamp !== null && new Date(rule.timestamp) > currentDate
  );

  if (nextRuleIndex === -1) {
    if (sortedRules.at(-1)?.timestamp === null) {
      return true;
    } else {
      return sortedRules.at(-1)?.enableFeature;
    }
  }

  return !sortedRules[nextRuleIndex].enableFeature;
};
