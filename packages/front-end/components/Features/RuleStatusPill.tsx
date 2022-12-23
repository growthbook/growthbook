import { FeatureRule, ScheduleRule } from "back-end/types/feature";
import { format as formatTimeZone } from "date-fns-tz";
import React from "react";

type Props = {
  rule: FeatureRule;
  upcomingScheduleRule: ScheduleRule | null;
  scheduleCompletedAndDisabled: boolean;
};

export default function RuleStatusPill({
  rule,
  upcomingScheduleRule,
  scheduleCompletedAndDisabled,
}: Props) {
  if (!rule.enabled) {
    return (
      <div className="mr-3">
        <div className="bg-secondary text-light border px-2 rounded">
          DISABLED
        </div>
      </div>
    );
  }

  if (scheduleCompletedAndDisabled) {
    return (
      <div className="mr-3">
        <div className="bg-info text-light border px-2 rounded">
          {`Rule was disabled by schedule rule on ${new Date(
            rule.scheduleRules[rule.scheduleRules.length - 1].timestamp
          ).toLocaleDateString()} at ${formatTimeZone(
            new Date(
              rule.scheduleRules[rule.scheduleRules.length - 1].timestamp
            ),
            "h:mm a z"
          )}`}
        </div>
      </div>
    );
  }

  if (upcomingScheduleRule) {
    return (
      <div className="mr-3">
        <div className="bg-info text-light border px-2 rounded">
          {`Rule will be ${
            upcomingScheduleRule.enabled ? "enabled" : "disabled"
          } on ${new Date(
            upcomingScheduleRule.timestamp
          ).toLocaleDateString()} at ${formatTimeZone(
            new Date(upcomingScheduleRule.timestamp),
            "h:mm a z"
          )}`}
        </div>
      </div>
    );
  }

  return null;
}
