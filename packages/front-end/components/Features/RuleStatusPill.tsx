import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { FeatureRule, ScheduleRule } from "back-end/types/feature";
import { format as formatTimeZone } from "date-fns-tz";
import React from "react";
import { isExperimentRefRuleSkipped } from "./ExperimentRefSummary";

type Props = {
  rule: FeatureRule;
  upcomingScheduleRule: ScheduleRule | null;
  scheduleCompletedAndDisabled: boolean;
  linkedExperiment?: ExperimentInterfaceStringDates;
};

export default function RuleStatusPill({
  rule,
  upcomingScheduleRule,
  scheduleCompletedAndDisabled,
  linkedExperiment,
}: Props) {
  if (!rule.enabled) {
    return (
      <div className="mr-3">
        <div className="bg-secondary text-light border px-2 rounded">
          Rule Disabled
        </div>
      </div>
    );
  }

  if (scheduleCompletedAndDisabled) {
    return (
      <div className="mr-3">
        <div className="bg-info text-light border px-2 rounded">
          {`Rule was disabled by schedule rule on ${new Date(
            // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
            rule.scheduleRules[rule.scheduleRules.length - 1].timestamp
          ).toLocaleDateString()} at ${formatTimeZone(
            new Date(
              // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
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
            // @ts-expect-error TS(2769) If you come across this, please fix it!: No overload matches this call.
            upcomingScheduleRule.timestamp
          ).toLocaleDateString()} at ${formatTimeZone(
            // @ts-expect-error TS(2769) If you come across this, please fix it!: No overload matches this call.
            new Date(upcomingScheduleRule.timestamp),
            "h:mm a z"
          )}`}
        </div>
      </div>
    );
  }

  if (linkedExperiment && isExperimentRefRuleSkipped(linkedExperiment)) {
    return (
      <div className="mr-3">
        <div className="bg-secondary text-light border px-2 rounded">
          Experiment not running
        </div>
      </div>
    );
  }

  return null;
}
