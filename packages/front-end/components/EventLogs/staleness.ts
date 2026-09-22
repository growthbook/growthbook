import type { EventLogSummaryItem } from "shared/validators";

/**
 * How long without an event before it counts as stale. Shared deliberately: the
 * "Stale" badge on the Last received column and the "Stopped arriving" filter
 * must never disagree about the same event — and now neither may the freshness
 * stamp in the card header, which is why the value lives with that component.
 */
export { STALE_AFTER_HOURS } from "@/components/Diagnostics/DataFreshness";
import { STALE_AFTER_HOURS } from "@/components/Diagnostics/DataFreshness";

const STALE_AFTER_MS = STALE_AFTER_HOURS * 60 * 60 * 1000;

/** True when the event has not been received within the stale threshold. */
export function isStale(lastReceived: string | null): boolean {
  if (!lastReceived) return false;
  const parsed = new Date(lastReceived).getTime();
  if (Number.isNaN(parsed)) return false;
  return Date.now() - parsed > STALE_AFTER_MS;
}

export type ArrivalStatus = "stoppedArriving" | "new";

/**
 * "Referenced but empty" is deliberately absent. It needs events with zero rows
 * in the window, which the summary query cannot return: it groups over rows
 * inside the window, so an event with none produces no group at all. Adding it
 * means sourcing the event list from the lookback and LEFT JOINing the window
 * counts — a restructure of the query, not another field.
 */
export const ARRIVAL_STATUS_LABELS: Record<ArrivalStatus, string> = {
  stoppedArriving: "Stopped arriving",
  new: "New",
};

export function matchesArrivalStatus(
  item: EventLogSummaryItem,
  status: ArrivalStatus,
  windowStart: Date,
): boolean {
  if (status === "stoppedArriving") return isStale(item.lastReceived);

  // "New" means the event did not exist before this window. firstSeen is a MIN
  // over in-window rows, so it always falls inside the window and would match
  // everything — firstEverSeen is the one that can answer this.
  if (!item.firstEverSeen) return false;
  const firstEver = new Date(item.firstEverSeen).getTime();
  if (Number.isNaN(firstEver)) return false;
  return firstEver >= windowStart.getTime();
}
