import { differenceInMinutes } from "date-fns";
import { getValidDate } from "shared/dates";
import { OrganizationSettings } from "shared/types/organization";

export const EXPERIMENT_RESULTS_UPDATE_DISABLED_MESSAGE =
  "Your organization has disabled updating results for stopped experiments and ended phases. For ad-hoc analysis, use custom reports.";

export function isExperimentResultsUpdateDisabled(
  experiment: {
    status: string;
    type?: string;
    phases?: { dateEnded?: string | Date }[];
  },
  phaseIndex: number,
  settings: Pick<
    OrganizationSettings,
    | "disableResultsUpdateForStoppedExperiments"
    | "disableResultsUpdateForStoppedExperimentGraceHours"
  >,
  now: Date = new Date(),
): boolean {
  if (!settings.disableResultsUpdateForStoppedExperiments) return false;
  const phases = experiment.phases ?? [];
  const lastIndex = phases.length - 1;
  const holdoutPhasesEndTogether = experiment.type === "holdout";
  const closingIndex = holdoutPhasesEndTogether ? lastIndex : phaseIndex;
  const lastPhaseIsStillOpen = experiment.status !== "stopped";
  if (closingIndex === lastIndex && lastPhaseIsStillOpen) return false;
  const dateEnded = phases[closingIndex]?.dateEnded;
  if (!dateEnded) return false;
  const graceHours =
    settings.disableResultsUpdateForStoppedExperimentGraceHours ?? 0;
  return differenceInMinutes(now, getValidDate(dateEnded)) / 60 >= graceHours;
}
