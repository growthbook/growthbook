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

/** The active phase (see getActivePhaseIndex), or undefined if none exist. */
export function getActivePhase<T>(experiment: {
  type?: ExperimentType;
  phases: T[];
}): T | undefined {
  return experiment.phases[getActivePhaseIndex(experiment)];
}
