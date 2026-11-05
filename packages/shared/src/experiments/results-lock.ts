import { differenceInHours } from "date-fns";
import { getValidDate } from "shared/dates";
import { OrganizationSettings } from "shared/types/organization";

export const STOPPED_EXPERIMENT_RESULTS_LOCK_MESSAGE =
  "Your organization has disabled updates on stopped experiments. For ad-hoc analysis, use custom reports.";

/**
 * True when the org setting freezes results for this stopped experiment: the
 * setting is on, the experiment is stopped, and the grace period (hours after
 * the last phase's end date) has elapsed. Custom reports are not covered by
 * this check; they use a separate snapshot path.
 */
export function isStoppedExperimentResultsLocked(
  experiment: {
    status: string;
    phases?: { dateEnded?: string | Date }[];
  },
  settings: Pick<
    OrganizationSettings,
    | "disableResultsRefreshForStoppedExperiments"
    | "stoppedExperimentResultsLockGraceHours"
  >,
  now: Date = new Date(),
): boolean {
  if (!settings.disableResultsRefreshForStoppedExperiments) return false;
  if (experiment.status !== "stopped") return false;
  const dateEnded =
    experiment.phases?.[experiment.phases.length - 1]?.dateEnded;
  if (!dateEnded) return false;
  const graceHours = settings.stoppedExperimentResultsLockGraceHours ?? 0;
  return differenceInHours(now, getValidDate(dateEnded)) >= graceHours;
}
