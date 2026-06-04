// Daily-grain alignment helpers for the covariate read paths. The aggregated
// fact table stores one row per `(idType, event_date)`, so both the
// pre-aggregated read and the daily-aligned legacy fallback snap covariate
// window bounds to UTC day starts and compare with the same operators
// (`event_date >= startDay`, `event_date < endDay`). Floor-snapping both bounds
// keeps the two paths mutually consistent — the value a unit gets from the
// aggregated table matches what the legacy fallback computes over the same days.

export function snapToUtcDayStart(date: Date): Date {
  const snapped = new Date(date);
  snapped.setUTCHours(0, 0, 0, 0);
  return snapped;
}

export function precedingUtcDayStart(date: Date): Date {
  const dayStart = snapToUtcDayStart(date);
  return new Date(dayStart.getTime() - 24 * 60 * 60 * 1000);
}
