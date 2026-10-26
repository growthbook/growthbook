import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { hasPendingScheduledStart } from "shared/util";
import { format } from "date-fns-tz";

export const scheduledTime = (value: string | Date) =>
  format(new Date(value), "MMM d, yyyy 'at' h:mm a (z)");

/** When a schedule ends: a date, or a span after the start. */
export const scheduledEnd = (
  schedule: ExperimentInterfaceStringDates["statusUpdateSchedule"],
) =>
  schedule?.stopAt
    ? scheduledTime(schedule.stopAt)
    : schedule?.stopAfter
      ? `${schedule.stopAfter.value} ${schedule.stopAfter.unit} after start`
      : null;

/** Whether a start or end is scheduled. A stop plan alone schedules nothing. */
export const hasStatusSchedule = (target: {
  statusUpdateSchedule?: object | null;
}) =>
  Object.entries(target.statusUpdateSchedule ?? {}).some(
    ([key, value]) => key !== "scheduledStopPlan" && (value ?? null) !== null,
  );

/** When an approved start fires, while one is armed. */
export const armedStartDate = (
  experiment: Pick<ExperimentInterfaceStringDates, "nextScheduledStatusUpdate">,
) =>
  hasPendingScheduledStart(experiment) &&
  experiment.nextScheduledStatusUpdate?.date
    ? new Date(experiment.nextScheduledStatusUpdate.date)
    : null;

/** A schedule in a sentence, e.g. "Starts manually and ends after 14 days." */
export const scheduleSummary = (
  schedule: ExperimentInterfaceStringDates["statusUpdateSchedule"],
) => {
  const at = (value: string | Date) =>
    format(new Date(value), "MMM d, yyyy h:mm a");
  const after = schedule?.stopAfter;
  const start = schedule?.startAt ? at(schedule.startAt) : null;
  const end = schedule?.stopAt
    ? at(schedule.stopAt)
    : after
      ? `after ${after.value} ${after.value === 1 ? after.unit.replace(/s$/, "") : after.unit}`
      : null;
  return !start && !end
    ? "Starts and ends manually."
    : `Starts ${start ?? "manually"} and ends ${end ?? "manually"}.`;
};
