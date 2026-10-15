import { ExperimentType } from "shared/types/experiment";

/**
 * Index of the phase governing targeting/traffic (and the live SDK payload).
 * Latest phase for most types; phase 0 for holdouts, whose later phase is an
 * analysis-only lookback that never governs targeting.
 */
export function getActivePhaseIndex(experiment: {
  type?: ExperimentType;
  phases: unknown[];
}): number {
  return experiment.type === "holdout" ? 0 : experiment.phases.length - 1;
}

/**
 * Clamp a window to the phase it is read against, so a "last 7 days" lookback
 * on a 3-day-old phase stops at the phase start, and an ended phase stops at
 * its end. Only applies once there is another phase the rows could belong to.
 * Holdout phases are analysis lookbacks, not traffic windows, so they are left
 * alone. The result can be empty (start >= end).
 */
export function clampWindowToPhase(
  window: { startDate: Date; endDate: Date },
  experiment: {
    type?: ExperimentType;
    phases: { dateStarted?: Date | string; dateEnded?: Date | string }[];
  },
  phaseIndex: number,
): { startDate: Date; endDate: Date } {
  const phase = experiment.phases[phaseIndex];
  if (!phase || experiment.phases.length < 2 || experiment.type === "holdout") {
    return window;
  }
  let { startDate, endDate } = window;
  if (phase.dateStarted) {
    const phaseStart = new Date(phase.dateStarted);
    if (phaseStart > startDate) startDate = phaseStart;
  }
  if (phase.dateEnded) {
    const phaseEnd = new Date(phase.dateEnded);
    if (phaseEnd < endDate) endDate = phaseEnd;
  }
  return { startDate, endDate };
}

/** The active phase (see getActivePhaseIndex), or undefined if none exist. */
export function getActivePhase<T>(experiment: {
  type?: ExperimentType;
  phases: T[];
}): T | undefined {
  return experiment.phases[getActivePhaseIndex(experiment)];
}
