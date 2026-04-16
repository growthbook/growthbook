import { addDays, addHours, addMonths, addWeeks } from "date-fns";
import type { ExperimentInterface } from "shared/types/experiment";

/** Allowed units for `maxExperimentDuration` on experiments and bandits. */
export const MAX_EXPERIMENT_DURATION_UNITS = [
  "hours",
  "days",
  "weeks",
  "months",
] as const;

export type MaxExperimentDurationUnit =
  (typeof MAX_EXPERIMENT_DURATION_UNITS)[number];

export type MaxExperimentDuration = {
  value: number;
  unit: MaxExperimentDurationUnit;
};

/** Default for newly created experiments when the field is omitted. */
export const DEFAULT_NEW_EXPERIMENT_MAX_DURATION: MaxExperimentDuration = {
  value: 3,
  unit: "months",
};

/**
 * Legacy running experiments (pre–max-duration feature) get an effective cap of
 * 100 years so behavior is unchanged until edited.
 */
export const MIGRATED_RUNNING_EXPERIMENT_MAX_DURATION: MaxExperimentDuration = {
  value: 1200,
  unit: "months",
};

type ExperimentMaxDurationFields = Pick<
  ExperimentInterface,
  "phases" | "type" | "banditStage" | "banditStageDateStarted"
> & {
  maxExperimentDuration?: MaxExperimentDuration;
};

/**
 * Calendar anchor for maximum experiment duration.
 *
 * **Standard experiments:** start of the latest phase (`dateStarted`).
 *
 * **Bandits:** start of the **explore** phase (beginning of the bandit). We use the
 * first `banditEvents[0].date` when present because that is logged when explore begins;
 * `banditStageDateStarted` is overwritten when moving explore → exploit, so it is not a
 * stable explore anchor after that transition. If there are no events yet, we use
 * `banditStageDateStarted` while still in `explore`, then fall back to the phase start.
 */
export function getMaxExperimentDurationAnchor(
  experiment: ExperimentMaxDurationFields,
): Date | null {
  const lastPhase = experiment.phases?.[experiment.phases.length - 1];
  const phaseStart = lastPhase?.dateStarted;

  if (experiment.type === "multi-armed-bandit") {
    const firstBanditEventDate = lastPhase?.banditEvents?.[0]?.date;
    if (firstBanditEventDate) {
      return new Date(firstBanditEventDate);
    }
    if (
      experiment.banditStage === "explore" &&
      experiment.banditStageDateStarted
    ) {
      return new Date(experiment.banditStageDateStarted);
    }
    if (phaseStart) {
      return new Date(phaseStart);
    }
    return null;
  }

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
    case "months":
      return addMonths(anchor, value);
    default: {
      const _exhaustive: never = unit;
      return _exhaustive;
    }
  }
}

/** Absolute end instant for the shipping deadline, or `null` if uncapped / unknown anchor. */
export function getMaxExperimentEndDate(
  experiment: ExperimentMaxDurationFields,
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
