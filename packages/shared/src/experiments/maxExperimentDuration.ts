import { addDays, addHours, addWeeks } from "date-fns";
import type { ExperimentInterface } from "shared/types/experiment";

/** Allowed units for `maxExperimentDuration` on experiments. Order: hours → days → weeks. */
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

type ExperimentType = NonNullable<ExperimentInterface["type"]>;
type NonBanditExperimentType = Exclude<ExperimentType, "multi-armed-bandit">;

export type ExperimentMaxDurationPhases = {
  phases?: Array<{
    dateStarted?: string | Date | null;
    banditEvents?: NonNullable<
      ExperimentInterface["phases"]
    >[number]["banditEvents"];
  }>;
};

/**
 * Bandit-only fields used to **derive** explore start when `banditExplorePeriodStart` is
 * omitted on {@link ExperimentMaxDurationFieldsInput}. They are not part of resolved
 * {@link ExperimentMaxDurationFields} (after {@link buildExperimentMaxDurationFields}).
 *
 * - **`banditStage` / `banditStageDateStarted`:** exploit vs explore and exploit clock;
 *   used with burn-in to recover explore start when the first `banditEvents` entry is at exploit.
 * - **`banditBurnInValue` / `banditBurnInUnit`:** length of explore; subtracted from exploit
 *   `banditStageDateStarted` when inferring explore start.
 */
export type ExperimentMaxDurationBanditDeriveSource =
  ExperimentMaxDurationPhases & {
    banditStage?: ExperimentInterface["banditStage"];
    banditStageDateStarted?: ExperimentInterface["banditStageDateStarted"];
    banditBurnInValue?: ExperimentInterface["banditBurnInValue"];
    banditBurnInUnit?: ExperimentInterface["banditBurnInUnit"];
  };

/** Pre-resolve payload (API / status hooks). Bandit explore start may be omitted and derived. */
export type ExperimentMaxDurationFieldsBanditInput =
  ExperimentMaxDurationBanditDeriveSource & {
    type: "multi-armed-bandit";
    banditExplorePeriodStart?: string | Date | null;
    maxExperimentDuration?: MaxExperimentDuration;
    targetSampleSize?: number;
  };

export type ExperimentMaxDurationFieldsNonBanditInput =
  ExperimentMaxDurationPhases & {
    type: NonBanditExperimentType;
    maxExperimentDuration?: MaxExperimentDuration;
    targetSampleSize?: number;
  };

export type ExperimentMaxDurationFieldsInput =
  | ExperimentMaxDurationFieldsBanditInput
  | ExperimentMaxDurationFieldsNonBanditInput;

/**
 * Normalized calendar context. For **bandits**, `banditExplorePeriodStart` is always set
 * (explicit or derived). Non-bandit variants never include bandit-only keys.
 */
export type ExperimentMaxDurationFieldsBandit = ExperimentMaxDurationPhases & {
  type: "multi-armed-bandit";
  banditExplorePeriodStart: string | Date;
  maxExperimentDuration?: MaxExperimentDuration;
  targetSampleSize?: number;
};

export type ExperimentMaxDurationFieldsNonBandit =
  ExperimentMaxDurationPhases & {
    type: NonBanditExperimentType;
    maxExperimentDuration?: MaxExperimentDuration;
    targetSampleSize?: number;
  };

export type ExperimentMaxDurationFields =
  | ExperimentMaxDurationFieldsBandit
  | ExperimentMaxDurationFieldsNonBandit;

function banditBurnInDurationMs(
  experiment: ExperimentMaxDurationBanditDeriveSource,
): number {
  const value =
    typeof experiment.banditBurnInValue === "number" &&
    Number.isFinite(experiment.banditBurnInValue)
      ? experiment.banditBurnInValue
      : 1;
  const unit = experiment.banditBurnInUnit ?? "days";
  const hoursMultiple = unit === "days" ? 24 : 1;
  return value * hoursMultiple * MS_PER_HOUR;
}

function coerceDate(value: string | Date | null | undefined): Date | null {
  if (value == null) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Bandits: anchor is explore period start, not the beginning of the current phase.
 */
function getBanditDurationAnchor(
  experiment: ExperimentMaxDurationBanditDeriveSource,
  lastPhase: NonNullable<ExperimentMaxDurationPhases["phases"]>[number],
): Date | null {
  const phaseStart = coerceDate(lastPhase.dateStarted);
  const stageStarted = coerceDate(experiment.banditStageDateStarted);
  const firstEvent = coerceDate(lastPhase.banditEvents?.[0]?.date);

  const exploreStartFromExploitClock =
    stageStarted != null
      ? new Date(stageStarted.getTime() - banditBurnInDurationMs(experiment))
      : null;

  const stage = experiment.banditStage;

  if (stage === "exploit") {
    if (
      firstEvent != null &&
      stageStarted != null &&
      firstEvent.getTime() < stageStarted.getTime()
    ) {
      return firstEvent;
    }
    if (exploreStartFromExploitClock != null) {
      return exploreStartFromExploitClock;
    }
    return phaseStart;
  }

  if (stage === "explore" || stage === undefined) {
    if (firstEvent != null) {
      return firstEvent;
    }
    return stageStarted ?? phaseStart;
  }

  // `paused`: `banditStageDateStarted` is often pause/stop — prefer first event if any.
  if (firstEvent != null) {
    return firstEvent;
  }
  return phaseStart;
}

/**
 * For bandits, fills `banditExplorePeriodStart` when omitted (same derivation as
 * {@link getMaxExperimentDurationAnchor}). For other types, returns a copy without
 * `banditExplorePeriodStart` if it was mistakenly set.
 */
export function buildExperimentMaxDurationFields(
  experiment: ExperimentMaxDurationFieldsInput,
): ExperimentMaxDurationFields {
  if (experiment.type === "multi-armed-bandit") {
    const banditExplorePeriodStart = coerceDate(
      experiment.banditExplorePeriodStart,
    );
    if (banditExplorePeriodStart) {
      return {
        type: "multi-armed-bandit",
        banditExplorePeriodStart: banditExplorePeriodStart,
        phases: experiment.phases,
        maxExperimentDuration: experiment.maxExperimentDuration,
        targetSampleSize: experiment.targetSampleSize,
      };
    }
    const lastPhase = experiment.phases?.[experiment.phases.length - 1];
    if (lastPhase) {
      const derived = getBanditDurationAnchor(experiment, lastPhase);
      if (derived != null) {
        return {
          type: "multi-armed-bandit",
          banditExplorePeriodStart: derived,
          phases: experiment.phases,
          maxExperimentDuration: experiment.maxExperimentDuration,
          targetSampleSize: experiment.targetSampleSize,
        };
      }
    }
    throw new Error(
      "buildExperimentMaxDurationFields: multi-armed-bandit needs banditExplorePeriodStart or resolvable phases (bandit events / stage / burn-in).",
    );
  }

  return {
    type: experiment.type,
    phases: experiment.phases,
    maxExperimentDuration: experiment.maxExperimentDuration,
    targetSampleSize: experiment.targetSampleSize,
  };
}

/**
 * Beginning of explore period for bandit, beginning of latest phase for other types. Accepts {@link ExperimentMaxDurationFieldsInput} so callers need not build first.
 */
export function getMaxExperimentDurationAnchor(
  experiment: ExperimentMaxDurationFieldsInput,
): Date | null {
  const lastPhase = experiment.phases?.[experiment.phases.length - 1];
  if (experiment.type === "multi-armed-bandit") {
    const banditExplorePeriodStart = coerceDate(
      experiment.banditExplorePeriodStart,
    );
    if (banditExplorePeriodStart) {
      return banditExplorePeriodStart;
    }
    return lastPhase ? getBanditDurationAnchor(experiment, lastPhase) : null;
  }
  return coerceDate(lastPhase?.dateStarted);
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
 * Nominal span of a configured max duration in milliseconds (fixed 24h days, 7-day weeks).
 * Used for display strings so formatting does not depend on the runtime timezone or DST;
 * `addMaxDurationToDate` still uses calendar semantics for real phase anchors.
 */
export function nominalMaxExperimentDurationMs(
  duration: MaxExperimentDuration,
): number {
  const { value, unit } = duration;
  switch (unit) {
    case "hours":
      return value * MS_PER_HOUR;
    case "days":
      return value * MS_PER_DAY;
    case "weeks":
      return value * 7 * MS_PER_DAY;
    default: {
      const _exhaustive: never = unit;
      return _exhaustive;
    }
  }
}

/**
 * Human-readable max duration for summary rows: **hours** if the configured window is
 * under 24 hours, otherwise **days** (from the nominal calendar length, with partial days
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
  const ms = nominalMaxExperimentDurationMs(duration);
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
  experiment: ExperimentMaxDurationFieldsInput,
): Date | null {
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
  experiment: ExperimentMaxDurationFieldsInput,
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
  experiment: Pick<ExperimentMaxDurationFieldsInput, "targetSampleSize">,
  totalUsers: number | null | undefined,
): boolean {
  const cap = experiment.targetSampleSize;
  if (cap == null || !Number.isFinite(cap) || cap < 1) {
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
