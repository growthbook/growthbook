import { differenceInMinutes } from "date-fns";
import { getValidDate } from "shared/dates";
import { OrganizationSettings } from "shared/types/organization";

export const EXPERIMENT_RESULTS_UPDATE_DISABLED_MESSAGE =
  "Your organization has disabled updating results for stopped experiments. For ad-hoc analysis, use custom reports.";

/**
 * True when the org setting freezes results for this stopped experiment: the
 * setting is on, the experiment is stopped, and the grace period (hours after
 * the last phase's end date) has elapsed. Custom reports are not covered by
 * this check; they use a separate snapshot path.
 */
export function isExperimentResultsUpdateDisabled(
  experiment: {
    status: string;
    phases?: { dateEnded?: string | Date }[];
  },
  settings: Pick<
    OrganizationSettings,
    | "disableResultsUpdateForStoppedExperiments"
    | "disableResultsUpdateForStoppedExperimentGraceHours"
  >,
  now: Date = new Date(),
): boolean {
  if (!settings.disableResultsUpdateForStoppedExperiments) return false;
  if (experiment.status !== "stopped") return false;
  const dateEnded =
    experiment.phases?.[experiment.phases.length - 1]?.dateEnded;
  if (!dateEnded) return false;
  const graceHours =
    settings.disableResultsUpdateForStoppedExperimentGraceHours ?? 0;
  return differenceInMinutes(now, getValidDate(dateEnded)) / 60 >= graceHours;
}
