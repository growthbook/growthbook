import { ScheduleRule, RampSchedule } from "shared/types/feature";

// Type after the filter is applied
type ScheduleRuleNoNulls = Omit<ScheduleRule, "timestamp"> & {
  timestamp: string;
};

export const getCurrentEnabledState = (
  scheduledRules: ScheduleRule[],
  now: Date,
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

/**
 * Given a rollout ramp schedule and the current time, return the effective
 * coverage that should be emitted to the SDK payload.
 *
 * Returns `null` when no schedule is present or `startedAt` has not yet been
 * stamped (rule is still in draft) — the caller should fall back to the
 * rule's static `coverage` field:
 *   `getCurrentRampCoverage(r.rampSchedule, now) ?? r.coverage`
 *
 * Otherwise, walk steps in order accumulating hold durations:
 *   window[0] = [0, steps[0].holdSeconds)
 *   window[n] = [sum(hold[0..n-1]), sum(hold[0..n]))
 * elapsed = max(0, now - startedAt); return coverage of the window containing
 * elapsed. Once elapsed >= sum(all holds), return 1 — the implicit terminal
 * state, held forever.
 */
export const getCurrentRampCoverage = (
  rampSchedule: RampSchedule | undefined,
  now: Date,
): number | null => {
  if (!rampSchedule || !rampSchedule.startedAt) return null;

  const elapsed = Math.max(
    0,
    (now.getTime() - new Date(rampSchedule.startedAt).getTime()) / 1000,
  );

  let windowEnd = 0;
  for (const step of rampSchedule.steps) {
    windowEnd += step.holdSeconds;
    if (elapsed < windowEnd) return step.coverage;
  }
  return 1;
};

/**
 * Returns the wall-clock time at which the next ramp step boundary occurs,
 * or `null` if the schedule is absent, not started, or already at the
 * implicit terminal 100%. Used by `getNextScheduledUpdate` to schedule the
 * next SDK payload rebuild.
 *
 * Boundaries are at startedAt + sum(hold[0..n]) for n in [0, steps.length).
 * The final boundary is the transition into the implicit 100% state.
 */
export const getNextRampUpdate = (
  rampSchedule: RampSchedule | undefined,
  now: Date,
): Date | null => {
  if (!rampSchedule || !rampSchedule.startedAt) return null;

  const startMs = new Date(rampSchedule.startedAt).getTime();
  const elapsed = Math.max(0, (now.getTime() - startMs) / 1000);

  let windowEnd = 0;
  for (const step of rampSchedule.steps) {
    windowEnd += step.holdSeconds;
    if (elapsed < windowEnd) return new Date(startMs + windowEnd * 1000);
  }
  return null;
};
