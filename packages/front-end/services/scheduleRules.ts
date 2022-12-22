import { FeatureRule, ScheduleRule } from "back-end/types/feature";

export function getUpcomingScheduleRule(
  rule: FeatureRule
): ScheduleRule | null {
  if (!rule.scheduleRules || !rule.scheduleRules.length) {
    return null;
  }
  const currentDate = new Date().valueOf();

  const nextRuleIndex = rule.scheduleRules.findIndex(
    (rule) =>
      rule.timestamp !== null &&
      new Date(rule.timestamp).valueOf() > currentDate
  );

  // If there was a rule with a timestamp greater than currentDate, return that rule
  if (nextRuleIndex > -1) {
    return rule.scheduleRules[nextRuleIndex];
  } else {
    // Otherwise, that means there aren't upcoming rules
    return null;
  }
}
