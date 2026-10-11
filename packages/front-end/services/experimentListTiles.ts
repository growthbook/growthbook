// The experiments list's tiles (set in review; in place of its tabs): which
// experiments each attention tile holds, and each tile's trend, for its
// sparkline and change figure.
//
// There's no history of when an experiment entered a tile, so the trend is
// estimated from a date per experiment (when it was last updated): how many
// of the tile's experiments fall in each of the last few weeks, and the
// change between the last 30 days and the 30 before. Prototype data, not a
// record.
import { ComputedExperimentInterface } from "shared/types/experiment";

const DAY_MS = 24 * 60 * 60 * 1000;

// The detailed statuses that ask for a call: ship, roll back, review, or
// decide on a stopped experiment.
const DECISION_STATUSES = new Set([
  "Ship now",
  "Roll back now",
  "Ready for review",
  "Awaiting decision",
]);

// How far ahead a scheduled stop counts as ending soon.
export const ENDING_SOON_DAYS = 7;

type TileExperiment = Pick<
  ComputedExperimentInterface,
  "status" | "statusIndicator" | "healthState" | "nextScheduledStatusUpdate"
>;

export function needsDecision(e: TileExperiment): boolean {
  return DECISION_STATUSES.has(e.statusIndicator?.detailedStatus ?? "");
}

export function isUnhealthy(e: TileExperiment): boolean {
  return e.healthState === "unhealthy";
}

export function isEndingSoon(
  e: TileExperiment,
  now: Date = new Date(),
): boolean {
  const next = e.nextScheduledStatusUpdate;
  if (e.status !== "running" || next?.type !== "stop") return false;
  const at = new Date(next.date).getTime();
  return (
    !Number.isNaN(at) &&
    at >= now.getTime() &&
    at <= now.getTime() + ENDING_SOON_DAYS * DAY_MS
  );
}

export type TileTrend = {
  // How many fall in each of the last `weeks` weeks, oldest first; the last
  // is the week to now.
  series: number[];
  // The change from the 30 days before to the last 30, as a whole
  // percentage; null when there were none before (no base) or no change.
  changePercent: number | null;
};

export function tileTrend(
  dates: string[],
  now: Date = new Date(),
  weeks = 8,
): TileTrend {
  const times = dates
    .map((d) => new Date(d).getTime())
    .filter((t) => !Number.isNaN(t));
  const end = now.getTime();
  const countIn = (from: number, to: number) =>
    times.filter((t) => t > from && t <= to).length;
  const series = Array.from({ length: weeks }, (_, i) => {
    const to = end - (weeks - 1 - i) * 7 * DAY_MS;
    return countIn(to - 7 * DAY_MS, to);
  });
  const recent = countIn(end - 30 * DAY_MS, end);
  const before = countIn(end - 60 * DAY_MS, end - 30 * DAY_MS);
  const changePercent =
    before === 0 || recent === before
      ? null
      : Math.round(((recent - before) / before) * 100);
  return { series, changePercent };
}
