import { FeatureRule, ScheduleRule } from "back-end/types/feature";
import React from "react";

type Props = {
  rule: FeatureRule;
  upcomingScheduleRule: ScheduleRule | null;
  currentScheduleStatus: "enabled" | "disabled";
};

export default function RuleStatusPill({
  rule,
  upcomingScheduleRule,
  currentScheduleStatus,
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

  if (
    currentScheduleStatus &&
    currentScheduleStatus === "disabled" &&
    rule.enabled
  ) {
    return (
      <div className="bg-info text-light border px-2 rounded">
        {`Rule was disabled by schedule rule on ${new Date(
          rule.scheduleRules[rule.scheduleRules.length - 1].timestamp
        ).toLocaleDateString()} at ${new Date(
          rule.scheduleRules[rule.scheduleRules.length - 1].timestamp
        ).toLocaleTimeString([], { timeStyle: "short" })} ${new Date(
          rule.scheduleRules[rule.scheduleRules.length - 1].timestamp
        )
          .toLocaleDateString(undefined, {
            day: "2-digit",
            timeZoneName: "short",
          })
          .substring(4)}`}
      </div>
    );
  }

  if (upcomingScheduleRule && rule.enabled) {
    return (
      <div className="bg-info text-light border px-2 rounded">
        {`Rule will be ${
          upcomingScheduleRule.enableFeature ? "enabled" : "disabled"
        } on ${new Date(
          upcomingScheduleRule.timestamp
        ).toLocaleDateString()} at ${new Date(
          upcomingScheduleRule.timestamp
        ).toLocaleTimeString([], { timeStyle: "short" })} ${new Date(
          upcomingScheduleRule.timestamp
        )
          .toLocaleDateString(undefined, {
            day: "2-digit",
            timeZoneName: "short",
          })
          .substring(4)}`}
      </div>
    );
  }

  return null;
}
