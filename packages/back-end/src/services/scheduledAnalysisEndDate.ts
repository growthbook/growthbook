import type { ExperimentUpdateSchedule } from "shared/types/organization";

// "HH:MM" in UTC, capturing hours and minutes
const ANALYSIS_END_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * The cutoff a scheduled update of a running phase analyzes through, or null
 * when it analyzes through its run time. The cutoff can be before the phase
 * started; callers decide what that means.
 */
export function getScheduledAnalysisEndDate(
  schedule: ExperimentUpdateSchedule | null,
  now: Date = new Date(),
): Date | null {
  let cutoff: Date | null = null;
  const mode = schedule?.analysisEndDateMode ?? "runTime";
  switch (mode) {
    case "lag": {
      const lagHours = Math.min(
        Math.max(schedule?.analysisEndDateLagHours || 0, 0),
        168,
      );
      cutoff = new Date(now.getTime() - lagHours * 60 * 60 * 1000);
      break;
    }
    case "fixedTime": {
      const time = schedule?.analysisEndDateTime;
      const match =
        typeof time === "string" ? time.match(ANALYSIS_END_TIME_PATTERN) : null;
      if (schedule?.type !== "cron" || !match) break;
      const today = Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        Number(match[1]),
        Number(match[2]),
      );
      cutoff = new Date(
        today > now.getTime() ? today - 24 * 60 * 60 * 1000 : today,
      );
      break;
    }
    case "runTime":
      break;
    default:
      mode satisfies never;
  }
  return cutoff && cutoff < now ? cutoff : null;
}

/** Why an update schedule's analysis end date settings can't be saved, if they can't. */
export function getAnalysisEndDateSettingsError(
  schedule: ExperimentUpdateSchedule | null | undefined,
): string | null {
  const mode = schedule?.analysisEndDateMode;
  if (mode === undefined || mode === "runTime") return null;
  if (mode === "lag") {
    const hours = schedule?.analysisEndDateLagHours;
    return typeof hours === "number" &&
      Number.isInteger(hours) &&
      hours >= 1 &&
      hours <= 168
      ? null
      : "Hours before the update runs must be a whole number between 1 and 168";
  }
  if (mode === "fixedTime") {
    if (schedule?.type !== "cron") {
      return "A most recent time of day cutoff requires a cron update schedule";
    }
    return typeof schedule.analysisEndDateTime === "string" &&
      ANALYSIS_END_TIME_PATTERN.test(schedule.analysisEndDateTime)
      ? null
      : "Time of day must be in HH:MM format (UTC)";
  }
  return `Unknown data cutoff: ${String(mode)}`;
}
