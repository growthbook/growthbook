import {
  ExperimentInterfaceStringDates,
  ExperimentPhaseStringDates,
} from "shared/types/experiment";
import { hasPendingScheduledStart } from "shared/util";
import { date, daysBetween } from "shared/dates";
import { format } from "date-fns-tz";

export const scheduledTime = (value: string | Date) =>
  format(new Date(value), "MMM d, yyyy 'at' h:mm a (z)");

const day = (value: string | Date) => date(value, "UTC");

const stopAfterSpan = ({ value, unit }: { value: number; unit: string }) =>
  `${value} ${value === 1 ? unit.replace(/s$/, "") : unit}`;

/** How long it ran between two dates, in whole days: "36 days", "under a day". */
export const runLength = (start: string | Date, end: string | Date) => {
  const days = daysBetween(start, end);
  return days < 1 ? "under a day" : `${days} ${days === 1 ? "day" : "days"}`;
};

/** When a schedule ends: a date, or a span after the start. */
export const scheduledEnd = (
  schedule: ExperimentInterfaceStringDates["statusUpdateSchedule"],
  formatAt: (value: string | Date) => string = scheduledTime,
) =>
  schedule?.stopAt
    ? formatAt(schedule.stopAt)
    : schedule?.stopAfter
      ? `${stopAfterSpan(schedule.stopAfter)} after start`
      : null;

/** Whether a start or end is scheduled. A stop plan alone schedules nothing. */
export const hasStatusSchedule = (target: {
  statusUpdateSchedule?: object | null;
}) =>
  Object.entries(target.statusUpdateSchedule ?? {}).some(
    ([key, value]) => key !== "scheduledStopPlan" && (value ?? null) !== null,
  );

type DatedExperiment = Pick<
  ExperimentInterfaceStringDates,
  "type" | "status" | "archived" | "dateCreated" | "statusUpdateSchedule"
> & {
  phases: Pick<ExperimentPhaseStringDates, "dateStarted" | "dateEnded">[];
};

export type LabeledDate = { label: string; value: string };

/** How long its one phase ran, or has so far while it runs; null if unknown. */
const soloRun = (experiment: DatedExperiment, now: Date) => {
  const { phases, status } = experiment;
  if (status === "draft" || experiment.type === "holdout") return null;
  if (phases.length !== 1) return null;
  const [{ dateStarted, dateEnded }] = phases;
  if (!dateStarted) return null;
  if (dateEnded) {
    return { ended: true, length: runLength(dateStarted, dateEnded) };
  }
  return status === "running"
    ? { ended: false, length: runLength(dateStarted, now) }
    : null;
};

/** When it's set to end, while that's still ahead. */
export const upcomingEnd = (
  experiment: Pick<
    ExperimentInterfaceStringDates,
    "status" | "archived" | "statusUpdateSchedule"
  >,
  now: Date,
) => {
  const schedule = experiment.statusUpdateSchedule;
  // Archived, its schedule never fires.
  return experiment.status === "stopped" ||
    experiment.archived ||
    (schedule?.stopAt && new Date(schedule.stopAt) <= now)
    ? null
    : scheduledEnd(schedule, day);
};

/**
 * The dates the header reads: created until it starts, then started; and when
 * it ended, or will. A passed end that kept it running is its banner's to say.
 */
export const headerDates = (
  experiment: DatedExperiment,
  now: Date,
): LabeledDate[] => {
  const { phases, status } = experiment;
  const isHoldout = experiment.type === "holdout";
  const latest = phases.at(-1);
  // A holdout's phases are one run, which began with the first.
  const started =
    status !== "draft"
      ? (isHoldout ? phases[0] : latest)?.dateStarted
      : undefined;
  const ended = status === "stopped" ? latest?.dateEnded : undefined;
  const ends = upcomingEnd(experiment, now);
  return [
    started
      ? {
          label:
            phases.length > 1 && !isHoldout
              ? "Latest phase started"
              : "Started",
          value: day(started),
        }
      : { label: "Created", value: day(experiment.dateCreated) },
    ...(ended ? [{ label: "Ended", value: day(ended) }] : []),
    ...(ends ? [{ label: "Ends", value: ends }] : []),
  ];
};

/**
 * Every date behind the header's: its creation, each phase and how long it
 * ran, its schedule.
 */
export const allDates = (
  experiment: DatedExperiment,
  now: Date,
): LabeledDate[] => {
  const { phases, status } = experiment;
  const isHoldout = experiment.type === "holdout";
  const schedule = experiment.statusUpdateSchedule;
  const dates = [{ label: "Created", value: day(experiment.dateCreated) }];
  if (status === "draft") {
    if (schedule?.startAt) {
      dates.push({
        label: "Scheduled start",
        value: scheduledTime(schedule.startAt),
      });
    }
  } else if (phases.length === 1 && !isHoldout) {
    const [{ dateStarted, dateEnded }] = phases;
    // How long it ran, beside the date it's measured to.
    const run = soloRun(experiment, now);
    if (dateStarted) {
      const running = run && !run.ended ? ` (running ${run.length})` : "";
      dates.push({ label: "Started", value: day(dateStarted) + running });
    }
    if (dateEnded) {
      const ran = run?.ended ? ` (ran ${run.length})` : "";
      dates.push({ label: "Ended", value: day(dateEnded) + ran });
    }
  } else {
    phases.forEach(({ dateStarted, dateEnded }, i) => {
      if (!dateStarted) return;
      const end = dateEnded
        ? day(dateEnded)
        : status === "running" && i === phases.length - 1
          ? "now"
          : null;
      dates.push({
        label: isHoldout
          ? i === 0
            ? "Holdout"
            : "Analysis"
          : `Phase ${i + 1}`,
        value: end
          ? `${day(dateStarted)} – ${end} (${runLength(dateStarted, dateEnded || now)})`
          : day(dateStarted),
      });
    });
  }
  // Archived, its schedule never fires.
  const end =
    status !== "stopped" && !experiment.archived
      ? scheduledEnd(schedule)
      : null;
  if (end) dates.push({ label: "Scheduled end", value: end });
  return dates;
};

/**
 * What the header's tooltip adds to its line, and nothing the line already
 * shows: how long it has run, then the rest of its dates.
 */
export const headerDetails = (experiment: DatedExperiment, now: Date) => {
  const shown = headerDates(experiment, now);
  const ends = shown.find(({ label }) => label === "Ends")?.value;
  const run = soloRun(experiment, now);
  return {
    runtime: run ? `${run.ended ? "Ran" : "Running"} for ${run.length}` : null,
    dates: allDates(experiment, now).filter(
      ({ label, value }) =>
        !shown.some((date) => date.label === label) &&
        // A span after the start reads the same on the line; a date adds its time.
        !(label === "Scheduled end" && value === ends),
    ),
  };
};

/** When an approved start fires, while one is armed. */
export const armedStartDate = (
  experiment: Pick<ExperimentInterfaceStringDates, "nextScheduledStatusUpdate">,
) =>
  hasPendingScheduledStart(experiment) &&
  experiment.nextScheduledStatusUpdate?.date
    ? new Date(experiment.nextScheduledStatusUpdate.date)
    : null;

/**
 * When an experiment starts and ends: a date or a span; null by hand. Once it
 * has actually started or stopped, its own dates, flagged as past.
 */
export const scheduleTimes = (
  experiment: Pick<
    ExperimentInterfaceStringDates,
    "status" | "statusUpdateSchedule"
  > & {
    phases: Pick<ExperimentPhaseStringDates, "dateStarted" | "dateEnded">[];
  },
) => {
  const at = (value: string | Date) =>
    format(new Date(value), "MMM d, yyyy h:mm a");
  const schedule = experiment.statusUpdateSchedule;
  const phase = experiment.phases.at(-1);
  const started =
    experiment.status !== "draft" ? phase?.dateStarted : undefined;
  const ended = experiment.status === "stopped" ? phase?.dateEnded : undefined;
  const after = schedule?.stopAfter;
  const start = started ?? schedule?.startAt;
  const end = ended ?? schedule?.stopAt;
  return {
    started: !!started,
    ended: !!ended,
    starts: start ? at(start) : null,
    ends: end ? at(end) : after ? `After ${stopAfterSpan(after)}` : null,
  };
};
