import { format } from "date-fns";
import type { ScaleTime } from "d3-scale";

// Room for one date label, so they never run into each other.
const TICK_SPACING = 90;
const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_MS = 28 * DAY_MS;

/**
 * The dates a time axis labels: as many as fit its width, or each point's own
 * once there are that few, formatted as finely as their spacing needs.
 */
export function dateAxisTicks(
  scale: ScaleTime<number, number>,
  width: number,
  points: Date[] = [],
): { ticks: Date[]; format: (d: Date) => string } {
  const count = Math.max(2, Math.floor(width / TICK_SPACING));
  const ticks =
    points.length && points.length <= count ? points : scale.ticks(count);
  const step =
    ticks.length > 1 ? ticks[1].getTime() - ticks[0].getTime() : DAY_MS;
  const pattern =
    step >= MONTH_MS ? "MMM yyyy" : step >= DAY_MS ? "MMM d" : "MMM d, h a";
  return { ticks, format: (d) => format(d, pattern) };
}

/** Of a run of events, only those at least `gap` pixels apart, so a burst reads as one. */
export function spacedOut(
  times: number[],
  scale: ScaleTime<number, number>,
  gap: number,
): number[] {
  let last = -Infinity;
  return times.filter((t) => {
    const x = scale(t);
    if (x - last < gap) return false;
    last = x;
    return true;
  });
}
