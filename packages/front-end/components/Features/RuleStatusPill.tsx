import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { FeatureRule, ScheduleRule } from "back-end/types/feature";
import { format as formatTimeZone } from "date-fns-tz";
import React from "react";
import { RxCircleBackslash } from "react-icons/rx";
import { PiArrowBendRightDown } from "react-icons/pi";
import { RiAlertLine } from "react-icons/ri";
import Badge from "@/components/Radix/Badge";
import { isExperimentRefRuleSkipped } from "./ExperimentRefSummary";

type Props = {
  rule: FeatureRule;
  upcomingScheduleRule: ScheduleRule | null;
  scheduleCompletedAndDisabled: boolean;
  linkedExperiment?: ExperimentInterfaceStringDates;
  ruleDisabled: boolean;
  unreachable?: boolean;
};

export default function RuleStatusPill({
  rule,
  upcomingScheduleRule,
  scheduleCompletedAndDisabled,
  linkedExperiment,
  ruleDisabled,
  unreachable,
}: Props) {
  if (!rule.enabled) {
    return (
      <Badge
        color="gray"
        title="Rule is not enabled"
        label={
          <>
            <RxCircleBackslash />
            Disabled
          </>
        }
      />
    );
  }

  if (unreachable && !ruleDisabled) {
    return (
      <Badge
        color="orange"
        title="Rule not reachable"
        label={
          <>
            <RiAlertLine />
            Unreachable
          </>
        }
      />
    );
  }

  const getSkippedBadge = (msg) => {
    return (
      <Badge
        color="amber"
        title={msg}
        label={
          <>
            <PiArrowBendRightDown />
            Skipped
          </>
        }
      />
    );
  };

  if (
    scheduleCompletedAndDisabled &&
    rule.scheduleRules &&
    rule.scheduleRules.length > 0
  ) {
    const lastRule = rule.scheduleRules[rule.scheduleRules.length - 1];
    if (lastRule && lastRule.timestamp) {
      const msg = `Disabled by a schedule on ${new Date(
        lastRule.timestamp
      ).toLocaleDateString()} at ${formatTimeZone(
        new Date(lastRule.timestamp),
        "h:mm a z"
      )}`;
      return getSkippedBadge(msg);
    }
  }

  if (upcomingScheduleRule && upcomingScheduleRule.timestamp) {
    const msg = `Will be ${
      upcomingScheduleRule.enabled ? "enabled" : "disabled"
    } on ${new Date(
      upcomingScheduleRule.timestamp
    ).toLocaleDateString()} at ${formatTimeZone(
      new Date(upcomingScheduleRule.timestamp),
      "h:mm a z"
    )}`;
    return getSkippedBadge(msg);
  }

  if (linkedExperiment && isExperimentRefRuleSkipped(linkedExperiment)) {
    const msg =
      linkedExperiment.type === "multi-armed-bandit"
        ? "Bandit not running"
        : "Experiment not running";
    return getSkippedBadge(msg);
  }

  return null;
}
