import {
  ExperimentInterfaceStringDates,
  ExperimentPhaseStringDates,
} from "shared/types/experiment";
import { hasPendingScheduledStart } from "shared/util";
import { date, daysBetween } from "shared/dates";
import { format } from "date-fns-tz";
import type { I18n } from "@lingui/core";
import { msg, plural } from "@lingui/core/macro";

export const scheduledTime = (value: string | Date) =>
  format(new Date(value), "MMM d, yyyy 'at' h:mm a (z)");

const day = (value: string | Date) => date(value, "UTC");

type StopAfter = { value: number; unit: "hours" | "days" };

/** "2 days after start" */
const afterStart = ({ value, unit }: StopAfter, i18n: I18n) =>
  unit === "hours"
    ? i18n._(
        msg`${plural(value, {
          one: "# hour after start",
          other: "# hours after start",
        })}`,
      )
    : i18n._(
        msg`${plural(value, {
          one: "# day after start",
          other: "# days after start",
        })}`,
      );

/** "After 2 days" */
const afterSpan = ({ value, unit }: StopAfter, i18n: I18n) =>
  unit === "hours"
    ? i18n._(
        msg`${plural(value, { one: "After # hour", other: "After # hours" })}`,
      )
    : i18n._(
        msg`${plural(value, { one: "After # day", other: "After # days" })}`,
      );

/** How long it ran between two dates, in whole days: "36 days", "under a day". */
export const runLength = (
  start: string | Date,
  end: string | Date,
  i18n: I18n,
) => {
  const days = daysBetween(start, end);
  return days < 1
    ? i18n._(msg`under a day`)
    : i18n._(msg`${plural(days, { one: "# day", other: "# days" })}`);
};

/** When a schedule ends: a date, or a span after the start. */
export const scheduledEnd = (
  schedule: ExperimentInterfaceStringDates["statusUpdateSchedule"],
  i18n: I18n,
  formatAt: (value: string | Date) => string = scheduledTime,
) =>
  schedule?.stopAt
    ? formatAt(schedule.stopAt)
    : schedule?.stopAfter
      ? afterStart(schedule.stopAfter, i18n)
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

// `key` names the date for code, `label` is its translated name.
export type LabeledDate = { key: string; label: string; value: string };

/** How long its one phase ran, or has so far while it runs; null if unknown. */
const soloRun = (experiment: DatedExperiment, now: Date, i18n: I18n) => {
  const { phases, status } = experiment;
  if (status === "draft" || experiment.type === "holdout") return null;
  if (phases.length !== 1) return null;
  const [{ dateStarted, dateEnded }] = phases;
  if (!dateStarted) return null;
  if (dateEnded) {
    return { ended: true, length: runLength(dateStarted, dateEnded, i18n) };
  }
  return status === "running"
    ? { ended: false, length: runLength(dateStarted, now, i18n) }
    : null;
};

/** When it's set to end, while that's still ahead. */
export const upcomingEnd = (
  experiment: Pick<
    ExperimentInterfaceStringDates,
    "status" | "archived" | "statusUpdateSchedule"
  >,
  now: Date,
  i18n: I18n,
) => {
  const schedule = experiment.statusUpdateSchedule;
  // Archived, its schedule never fires.
  return experiment.status === "stopped" ||
    experiment.archived ||
    (schedule?.stopAt && new Date(schedule.stopAt) <= now)
    ? null
    : scheduledEnd(schedule, i18n, day);
};

/**
 * The dates the header reads: created until it starts, then started; and when
 * it ended, or will. A passed end that kept it running is its banner's to say.
 */
export const headerDates = (
  experiment: DatedExperiment,
  now: Date,
  i18n: I18n,
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
  const ends = upcomingEnd(experiment, now, i18n);
  return [
    started
      ? phases.length > 1 && !isHoldout
        ? {
            key: "latest-phase-started",
            label: i18n._(msg`Latest phase started`),
            value: day(started),
          }
        : { key: "started", label: i18n._(msg`Started`), value: day(started) }
      : {
          key: "created",
          label: i18n._(msg`Created`),
          value: day(experiment.dateCreated),
        },
    ...(ended
      ? [{ key: "ended", label: i18n._(msg`Ended`), value: day(ended) }]
      : []),
    ...(ends ? [{ key: "ends", label: i18n._(msg`Ends`), value: ends }] : []),
  ];
};

/**
 * Every date behind the header's: its creation, each phase and how long it
 * ran, its schedule.
 */
export const allDates = (
  experiment: DatedExperiment,
  now: Date,
  i18n: I18n,
): LabeledDate[] => {
  const { phases, status } = experiment;
  const isHoldout = experiment.type === "holdout";
  const schedule = experiment.statusUpdateSchedule;
  const dates: LabeledDate[] = [
    {
      key: "created",
      label: i18n._(msg`Created`),
      value: day(experiment.dateCreated),
    },
  ];
  if (status === "draft") {
    if (schedule?.startAt) {
      dates.push({
        key: "scheduled-start",
        label: i18n._(msg`Scheduled start`),
        value: scheduledTime(schedule.startAt),
      });
    }
  } else if (phases.length === 1 && !isHoldout) {
    const [{ dateStarted, dateEnded }] = phases;
    // How long it ran, beside the date it's measured to.
    const run = soloRun(experiment, now, i18n);
    if (dateStarted) {
      const started = day(dateStarted);
      let value = started;
      if (run && !run.ended) {
        const length = run.length;
        value = i18n._(msg`${started} (running ${length})`);
      }
      dates.push({ key: "started", label: i18n._(msg`Started`), value });
    }
    if (dateEnded) {
      const ended = day(dateEnded);
      let value = ended;
      if (run?.ended) {
        const length = run.length;
        value = i18n._(msg`${ended} (ran ${length})`);
      }
      dates.push({ key: "ended", label: i18n._(msg`Ended`), value });
    }
  } else {
    phases.forEach(({ dateStarted, dateEnded }, i) => {
      if (!dateStarted) return;
      const end = dateEnded
        ? day(dateEnded)
        : status === "running" && i === phases.length - 1
          ? i18n._(msg`now`)
          : null;
      const number = i + 1;
      dates.push({
        key: isHoldout ? (i === 0 ? "holdout" : "analysis") : `phase-${number}`,
        label: isHoldout
          ? i === 0
            ? i18n._(msg`Holdout`)
            : i18n._(msg`Analysis`)
          : i18n._(msg`Phase ${number}`),
        value: end
          ? `${day(dateStarted)} – ${end} (${runLength(dateStarted, dateEnded || now, i18n)})`
          : day(dateStarted),
      });
    });
  }
  // Archived, its schedule never fires.
  const end =
    status !== "stopped" && !experiment.archived
      ? scheduledEnd(schedule, i18n)
      : null;
  if (end) {
    dates.push({
      key: "scheduled-end",
      label: i18n._(msg`Scheduled end`),
      value: end,
    });
  }
  return dates;
};

/**
 * What the header's tooltip adds to its line, and nothing the line already
 * shows: how long it has run, then the rest of its dates.
 */
export const headerDetails = (
  experiment: DatedExperiment,
  now: Date,
  i18n: I18n,
) => {
  const shown = headerDates(experiment, now, i18n);
  const ends = shown.find(({ key }) => key === "ends")?.value;
  const run = soloRun(experiment, now, i18n);
  let runtime: string | null = null;
  if (run) {
    const length = run.length;
    runtime = run.ended
      ? i18n._(msg`Ran for ${length}`)
      : i18n._(msg`Running for ${length}`);
  }
  return {
    runtime,
    dates: allDates(experiment, now, i18n).filter(
      ({ key, value }) =>
        !shown.some((date) => date.key === key) &&
        // A span after the start reads the same on the line; a date adds its time.
        !(key === "scheduled-end" && value === ends),
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
  i18n: I18n,
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
    ends: end ? at(end) : after ? afterSpan(after, i18n) : null,
  };
};
