import { FeatureRule, ScheduleRule } from "back-end/types/feature";

export function getUpcomingScheduleRule(
  rule: FeatureRule
): ScheduleRule | null {
  if (!rule.scheduleRules || !rule.scheduleRules.length) {
    return null;
  }
  const currentDate = new Date().valueOf();

  if (rule.scheduleRules && rule.scheduleRules.length) {
    const nextRuleIndex = rule.scheduleRules.findIndex(
      (rule) =>
        rule.timestamp !== null &&
        currentDate < new Date(rule.timestamp).valueOf()
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
}

export function getCurrentStatus(
  rule: FeatureRule,
  upcomingScheduleRule: ScheduleRule | null
): "enabled" | "disabled" {
  if (!upcomingScheduleRule && rule.scheduleRules.length) {
    if (rule.scheduleRules[rule.scheduleRules.length - 1].timestamp === null) {
      return "enabled";
    } else {
      return "disabled";
    }
  }
  if (!rule.scheduleRules || !rule.scheduleRules.length) {
    return "enabled";
  }
}
