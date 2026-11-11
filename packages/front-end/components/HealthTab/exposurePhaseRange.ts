import type { ExplorationDateRange } from "shared/validators";
import { calculateProductAnalyticsDateRange } from "shared/enterprise";
import { DEFAULT_RECORDS_DATE_RANGE } from "@/components/Diagnostics/useRecordsQuery";

const DAY_MS = 24 * 60 * 60 * 1000;

/** A phase's span; `end` is null while the phase is still running. */
export interface PhaseBounds {
  start: Date | null;
  end: Date | null;
}

export function getPhaseBounds(phase?: {
  dateStarted?: string;
  dateEnded?: string;
}): PhaseBounds {
  const parse = (value?: string) => {
    if (!value) return null;
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  };
  return { start: parse(phase?.dateStarted), end: parse(phase?.dateEnded) };
}

// ponytail: the shared range control only offers calendar days for custom
// ranges, so a range anchored to a phase edge is rounded out to whole UTC days
// and can still reach past the phase (the warning says so). The upgrade path
// is date-time support in the picker.
function customDays(start: Date, end: Date): ExplorationDateRange {
  return {
    predefined: "customDateRange",
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

/**
 * The last 24 hours of the phase: a plain lookback while it runs, and the day
 * before its end once it has stopped (no shorter than the phase itself).
 */
export function phaseLast24Hours(bounds: PhaseBounds): ExplorationDateRange {
  if (!bounds.end) return DEFAULT_RECORDS_DATE_RANGE;
  const start = new Date(
    Math.max(bounds.end.getTime() - DAY_MS, bounds.start?.getTime() ?? 0),
  );
  return customDays(start, bounds.end);
}

export function entirePhaseRange(
  bounds: PhaseBounds,
): ExplorationDateRange | null {
  return bounds.start
    ? customDays(bounds.start, bounds.end ?? new Date())
    : null;
}

/** Whether the resolved range reaches outside the phase's actual timestamps. */
export function rangeExceedsPhase(
  range: ExplorationDateRange,
  bounds: PhaseBounds,
): boolean {
  if (!bounds.start) return false;
  const { startDate, endDate } = calculateProductAnalyticsDateRange(range);
  if (startDate < bounds.start) return true;
  return bounds.end !== null && endDate > bounds.end;
}
