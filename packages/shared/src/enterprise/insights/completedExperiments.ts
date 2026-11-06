import {
  ExperimentInterface,
  ExperimentInterfaceStringDates,
} from "shared/types/experiment";

export type InsightsExperiment =
  | ExperimentInterface
  | ExperimentInterfaceStringDates;
export type InsightsWindow = { startDate: Date; endDate: Date };

type PhaseDates = { name: string; dateEnded?: Date | string | null };

/**
 * The date an experiment "completed", using the same rule as the Executive
 * Report: the most recent "Main" phase end, falling back to the most recent
 * phase end. Returns null when no phase has ended.
 */
export function getExperimentResultDate(experiment: {
  phases: PhaseDates[];
}): Date | null {
  const sortByEndedDesc = (a: PhaseDates, b: PhaseDates) =>
    new Date(b.dateEnded || 0).getTime() - new Date(a.dateEnded || 0).getTime();

  const mainPhase = experiment.phases
    .filter((p) => p.name === "Main")
    .sort(sortByEndedDesc)[0];
  const usedPhase =
    mainPhase ?? [...experiment.phases].sort(sortByEndedDesc)[0];

  if (!usedPhase?.dateEnded) return null;
  return new Date(usedPhase.dateEnded);
}

/**
 * Filter the org's experiments to the completed set inside a window:
 * standard (non-bandit), stopped, project-scoped, with a result date
 * (getExperimentResultDate) inside [startDate, endDate].
 *
 * Using the single result date — rather than "any phase ended in-window" —
 * keeps this filter consistent with bucketVelocity, so the Win Percentage and
 * Team Velocity blocks count exactly the same experiments for a given window.
 */
export function filterCompletedExperiments<
  T extends Pick<InsightsExperiment, "type" | "status" | "project"> & {
    phases: PhaseDates[];
  },
>(
  experiments: T[],
  { startDate, endDate, projects }: InsightsWindow & { projects: string[] },
): T[] {
  return experiments
    .filter((e) => e.type !== "multi-armed-bandit")
    .filter((e) => e.status === "stopped")
    .filter(
      (e) =>
        projects.length === 0 ||
        (e.project ? projects.includes(e.project) : false),
    )
    .filter((e) => {
      const resultDate = getExperimentResultDate(e);
      if (!resultDate) return false;
      return resultDate >= startDate && resultDate <= endDate;
    });
}
