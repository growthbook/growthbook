import { FeatureRule, ScheduleRule } from "back-end/types/feature";
import { format as formatTimeZone } from "date-fns-tz";
import React from "react";
import Callout from "@/components/Radix/Callout";

type Props = {
  rule: FeatureRule;
  upcomingScheduleRule: ScheduleRule | null;
  scheduleCompletedAndDisabled: boolean;
  ruleDisabled: boolean;
  unreachable?: boolean;
};

export default function RuleStatusMsg({
  rule,
  upcomingScheduleRule,
  scheduleCompletedAndDisabled,
  ruleDisabled,
  unreachable,
}: Props) {
  if (
    scheduleCompletedAndDisabled &&
    rule.scheduleRules &&
    rule.scheduleRules.length > 0
  ) {
    const lastRule = rule.scheduleRules[rule.scheduleRules.length - 1];
    if (lastRule && lastRule.timestamp) {
      return (
        <Callout status="warning">
          Disabled by a schedule on{" "}
          {new Date(lastRule.timestamp).toLocaleDateString()} at{" "}
          {formatTimeZone(new Date(lastRule.timestamp), "h:mm a z")}
        </Callout>
      );
    }
  }
  if (unreachable && !ruleDisabled) {
    return (
      <Callout status="warning">
        Rules above will serve 100% of traffic and this rule will never be used
      </Callout>
    );
  }

  if (upcomingScheduleRule && upcomingScheduleRule.timestamp) {
    return (
      <Callout status="warning">
        Will be {upcomingScheduleRule.enabled ? "enabled" : "disabled"} on{" "}
        {new Date(upcomingScheduleRule.timestamp).toLocaleDateString()} at{" "}
        {formatTimeZone(new Date(upcomingScheduleRule.timestamp), "h:mm a z")}
      </Callout>
    );
  }

  return null;
}
