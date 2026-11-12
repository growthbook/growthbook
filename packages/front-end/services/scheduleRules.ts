import { FeatureRule, ScheduleRule } from "shared/types/feature";
import { RampScheduleInterface } from "shared/validators";

export function getUpcomingScheduleRule(
  rule: FeatureRule,
): ScheduleRule | null {
  if (!rule.scheduleRules || !rule.scheduleRules.length) {
    return null;
  }
  const currentDate = new Date().valueOf();

  const nextRuleIndex = rule.scheduleRules.findIndex(
    (rule) =>
      rule.timestamp !== null &&
      new Date(rule.timestamp).valueOf() > currentDate,
  );

  // If there was a rule with a timestamp greater than currentDate, return that rule
  if (nextRuleIndex > -1) {
    return rule.scheduleRules[nextRuleIndex];
  } else {
    // Otherwise, that means there aren't upcoming rules
    return null;
  }
}

// A schedule's verb for a date, in the past tense once the date has passed:
// ("Starts", "Started"), ("Disables", "Disabled").
export function scheduleVerb(
  date: Date | string,
  upcoming: string,
  passed: string,
  now: Date = new Date(),
): string {
  return new Date(date) > now ? upcoming : passed;
}

type ScheduleDateFields = Pick<
  RampScheduleInterface,
  | "status"
  | "steps"
  | "startDate"
  | "startedAt"
  | "cutoffDate"
  | "eventHistory"
  | "dateUpdated"
>;

// When a ramp schedule finished, from its event log; one logged before the log
// existed falls back to its last update.
export function rampCompletedAt(rs: ScheduleDateFields): Date | null {
  if (rs.status !== "completed") return null;
  const completed = [...(rs.eventHistory ?? [])]
    .reverse()
    .find((e) => e.type === "completed");
  const at = completed?.timestamp ?? rs.dateUpdated;
  return at ? new Date(at) : null;
}

export type ScheduleDate = { label: string; date: Date };

// A schedule's dates as they stand: when it starts (or actually started), and
// when it disables or, without a disable date, when it completed. A simple
// schedule's only events are the rule turning on at its start date and off at
// its disable date, so it reads as those.
export function rampScheduleDates(
  rs: ScheduleDateFields,
  now: Date = new Date(),
): { start: ScheduleDate | null; end: ScheduleDate | null } {
  const simple = rs.steps.length === 0;
  // A finished schedule with no record of starting started on its planned date.
  const startedAt =
    rs.startedAt ?? (rs.status === "completed" ? rs.startDate : null);
  let start: ScheduleDate | null = null;
  if (simple) {
    if (rs.startDate) {
      start = startedAt
        ? { label: "Enabled", date: new Date(startedAt) }
        : { label: "Enables", date: new Date(rs.startDate) };
    }
  } else if (startedAt) {
    start = { label: "Started", date: new Date(startedAt) };
  } else if (rs.startDate) {
    start = { label: "Starts", date: new Date(rs.startDate) };
  }
  let end: ScheduleDate | null = null;
  if (rs.cutoffDate) {
    const cutoff = new Date(rs.cutoffDate);
    end = {
      label: scheduleVerb(cutoff, "Disables", "Disabled", now),
      date: cutoff,
    };
  } else if (!simple) {
    const completedAt = rampCompletedAt(rs);
    if (completedAt) end = { label: "Completed", date: completedAt };
  }
  return { start, end };
}

// When a ramp schedule last reached a step, from its event log.
export function rampStepReachedAt(
  rs: Pick<RampScheduleInterface, "eventHistory">,
  stepIndex: number,
): Date | null {
  const reached = [...(rs.eventHistory ?? [])]
    .reverse()
    .find(
      (e) =>
        (e.type === "started" ||
          e.type === "step-advanced" ||
          e.type === "step-jumped") &&
        e.stepIndex === stepIndex,
    );
  return reached ? new Date(reached.timestamp) : null;
}
