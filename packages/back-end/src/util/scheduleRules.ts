import { ScheduleRule } from "../../types/feature";

// Type after the filter is applied
type ScheduleRuleNoNulls = Omit<ScheduleRule, "timestamp"> & {
  timestamp: string;
};

export const getCurrentEnabledState = (
  scheduledRules: ScheduleRule[],
  now: Date
) => {
  const sorted = scheduledRules
    // Remove nulls
    .filter((s): s is ScheduleRuleNoNulls => !!s.timestamp)
    // Convert timestamps to date objects
    .map((s) => ({
      date: new Date(s.timestamp as string),
      enabled: s.enabled ? true : false,
    }))
    // Sort ascending
    .sort((a, b) => a.date.valueOf() - b.date.valueOf());

  // No schedule means it should be enabled
  if (!sorted.length) return true;

  // Start with the opposite of the first schedule rule
  // e.g. if first rule turns it on, initial state should be off
  let currentState = !sorted[0].enabled;

  // Loop until we reach a date in the future
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].date > now) break;
    // If this date is in the past, update the state
    currentState = sorted[i].enabled;
  }

  return currentState;
};
