import { addDays, addHours, addWeeks } from "date-fns";
import type { ExperimentInterface } from "shared/types/experiment";

/** Allowed units for `maxExperimentDuration` on experiments (not bandits). Order: hours → days → weeks. */
export const MAX_EXPERIMENT_DURATION_UNITS = [
  "hours",
  "days",
  "weeks",
] as const;

export type MaxExperimentDurationUnit =
  (typeof MAX_EXPERIMENT_DURATION_UNITS)[number];

export type MaxExperimentDuration = {
  value: number;
  unit: MaxExperimentDurationUnit;
};

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

/** Default for newly created experiments when the field is omitted. */
export const DEFAULT_NEW_EXPERIMENT_MAX_DURATION: MaxExperimentDuration = {
  value: 365,
  unit: "days",
};

/**
 * Running experiments that had no max duration when the feature shipped get this cap
 * until an editor saves a different value.
 */
export const MIGRATED_RUNNING_EXPERIMENT_MAX_DURATION: MaxExperimentDuration = {
  value: 365,
  unit: "days",
};

/**
 * Minimal experiment shape for calendar max-duration math.
 * Accepts API/string-dated phases (e.g. `ExperimentDataForStatusStringDates`) as well as `Date` phases.
 */
export type ExperimentMaxDurationFields = {
  type?: ExperimentInterface["type"];
  phases?: Array<{
    dateStarted?: string | Date | null;
    banditEvents?: NonNullable<
      ExperimentInterface["phases"]
    >[number]["banditEvents"];
  }>;
  banditStage?: ExperimentInterface["banditStage"];
  banditStageDateStarted?: ExperimentInterface["banditStageDateStarted"];
  maxExperimentDuration?: MaxExperimentDuration;
  /** Optional target sample size (latest snapshot `health.totalUsers`). Independent of calendar max duration. */
  targetSampleSize?: number;
};

/**
 * Calendar anchor for maximum experiment duration (start of the latest phase).
 * Multi-armed bandits do not support a maximum duration cap; this returns `null` for them.
 */
export function getMaxExperimentDurationAnchor(
  experiment: ExperimentMaxDurationFields,
): Date | null {
  if (experiment.type === "multi-armed-bandit") {
    return null;
  }

  const lastPhase = experiment.phases?.[experiment.phases.length - 1];
  const phaseStart = lastPhase?.dateStarted;

  if (phaseStart) {
    return new Date(phaseStart);
  }
  return null;
}

export function addMaxDurationToDate(
  anchor: Date,
  duration: MaxExperimentDuration,
): Date {
  const { value, unit } = duration;
  switch (unit) {
    case "hours":
      return addHours(anchor, value);
    case "days":
      return addDays(anchor, value);
    case "weeks":
      return addWeeks(anchor, value);
    default: {
      const _exhaustive: never = unit;
      return _exhaustive;
    }
  }
}

/**
 * Human-readable max duration for summary rows: **hours** if the configured window is
 * under 24 hours, otherwise **days** (from the true calendar length, with partial days
 * rounded up).
 */
export function formatMaxExperimentDuration(
  duration: MaxExperimentDuration | null | undefined,
): string {
  if (
    duration == null ||
    duration.value == null ||
    Number.isNaN(duration.value) ||
    !duration.unit
  ) {
    return "—";
  }
  const anchor = new Date("2000-01-01T00:00:00.000Z");
  const end = addMaxDurationToDate(anchor, duration);
  const ms = end.getTime() - anchor.getTime();
  const hoursTotal = ms / MS_PER_HOUR;

  if (hoursTotal < 24) {
    const h = Math.round(hoursTotal);
    return `${h} ${h === 1 ? "hour" : "hours"}`;
  }

  const daysTotal = Math.ceil(ms / MS_PER_DAY);
  return `${daysTotal} ${daysTotal === 1 ? "day" : "days"}`;
}

/** Absolute end instant for the shipping deadline, or `null` if uncapped / unknown anchor. */
export function getMaxExperimentEndDate(
  experiment: ExperimentMaxDurationFields,
): Date | null {
  if (experiment.type === "multi-armed-bandit") {
    return null;
  }
  if (!experiment.maxExperimentDuration) {
    return null;
  }
  const anchor = getMaxExperimentDurationAnchor(experiment);
  if (!anchor) {
    return null;
  }
  return addMaxDurationToDate(anchor, experiment.maxExperimentDuration);
}

/**
 * Whole calendar days from `now` until `getMaxExperimentEndDate`, rounded **up** (any
 * partial day counts as a full day). Returns `null` if there is no configured cap.
 */
export function getCalendarDaysRemainingUntilMaxExperimentEnd(
  experiment: ExperimentMaxDurationFields,
  now: Date = new Date(),
): number | null {
  const end = getMaxExperimentEndDate(experiment);
  if (!end) {
    return null;
  }
  const rawDays = (end.getTime() - now.getTime()) / MS_PER_DAY;
  return Math.max(0, Math.ceil(rawDays));
}

/** True when `targetSampleSize` is set and latest total users meets or exceeds it. */
export function isTargetSampleSizeReached(
  experiment: ExperimentMaxDurationFields,
  totalUsers: number | null | undefined,
): boolean {
  const cap = experiment.targetSampleSize;
  if (cap == null || !Number.isFinite(cap) || cap < 1) {
    return false;
  }
  if (experiment.type === "multi-armed-bandit") {
    return false;
  }
  if (totalUsers == null || !Number.isFinite(totalUsers)) {
    return false;
  }
  return totalUsers >= cap;
}

export function formatTargetSampleSize(
  value: number | null | undefined,
): string {
  if (value == null || !Number.isFinite(value) || value < 1) {
    return "—";
  }
  return `${Math.round(value).toLocaleString()}`;
}
