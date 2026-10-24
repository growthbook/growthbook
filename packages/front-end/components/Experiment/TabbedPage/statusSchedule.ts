import { ExperimentInterfaceStringDates } from "shared/types/experiment";
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

/** An experiment's or a holdout's. */
export const hasStatusSchedule = (target: {
  statusUpdateSchedule?: object | null;
}) =>
  Object.values(target.statusUpdateSchedule ?? {}).some(
    (value) => value !== null,
  );
