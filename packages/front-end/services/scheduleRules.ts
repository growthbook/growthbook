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

  if (
    nextRuleIndex === -1 &&
    rule.scheduleRules[rule.scheduleRules.length - 1].timestamp === null
  ) {
    return null;
  }

  if (nextRuleIndex > -1) {
    return rule.scheduleRules[nextRuleIndex];
  }
}

export function getCurrentStatus(
  rule: FeatureRule,
  upcomingScheduleRule: ScheduleRule | null
): "enabled" | "disabled" {
  console.log("upcomingScheduleRule", upcomingScheduleRule);
  if (!rule.scheduleRules || !rule.scheduleRules.length) {
    return "enabled";
  }

  if (!upcomingScheduleRule) {
    if (rule.scheduleRules[rule.scheduleRules.length - 1].timestamp === null) {
      return "enabled";
    } else {
      return "disabled";
    }
  }
  //TODO: What if there IS an upcomingScheduleRule?
}
