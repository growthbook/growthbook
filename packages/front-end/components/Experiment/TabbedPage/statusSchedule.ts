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

/** When an experiment starts and ends: a date or a span; null by hand. */
export const scheduleTimes = (
  experiment: Pick<
    ExperimentInterfaceStringDates,
    "status" | "phases" | "statusUpdateSchedule"
  >,
) => {
  const at = (value: string | Date) =>
    format(new Date(value), "MMM d, yyyy h:mm a");
  const schedule = experiment.statusUpdateSchedule;
  const phase = experiment.phases.at(-1);
  const started =
    experiment.status !== "draft" ? phase?.dateStarted : undefined;
  const ended = experiment.status === "stopped" ? phase?.dateEnded : undefined;
  const after = schedule?.stopAfter;
  const start = schedule?.startAt ?? started;
  const end = schedule?.stopAt ?? ended;
  return {
    starts: start ? at(start) : null,
    ends: end
      ? at(end)
      : after
        ? `After ${after.value} ${after.value === 1 ? after.unit.replace(/s$/, "") : after.unit}`
        : null,
  };
};
